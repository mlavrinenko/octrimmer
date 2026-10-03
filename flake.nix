{
  description = "octrimmer — manual context trimmer for OpenCode";

  inputs = {
    flake-utils.url = "github:numtide/flake-utils";
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    qahq.url = "github:mlavrinenko/qahq";
  };

  # qahq's binary cache ships prebuilt jscpd (and other home tools), so
  # consumers do not compile them from source. Do NOT make qahq follow this
  # repo's nixpkgs: the cache answers against qahq's own pin.
  nixConfig = {
    extra-substituters = [ "https://qahq.cachix.org" ];
    extra-trusted-public-keys = [
      "qahq.cachix.org-1:m43yxxOk1vih9jTZmKXZXgHSSKsW/rNVZUqgXqrELM8="
    ];
  };

  outputs =
    {
      self,
      flake-utils,
      nixpkgs,
      qahq,
      ...
    }:
    {
      # Home-manager: `programs.octrimmer.enable = true;` links the plugin into
      # ~/.config/opencode/plugins/, and the plugin registers its own skill.
      homeManagerModules.default =
        {
          config,
          lib,
          pkgs,
          ...
        }:
        let
          cfg = config.programs.octrimmer;
        in
        {
          options.programs.octrimmer = {
            enable = lib.mkEnableOption "octrimmer, the trim-context plugin for opencode";
            package = lib.mkOption {
              type = lib.types.package;
              default = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
              defaultText = lib.literalExpression "octrimmer.packages.\${system}.default";
              description = "The octrimmer package to load.";
            };
          };
          config = lib.mkIf cfg.enable {
            xdg.configFile."opencode/plugins/octrimmer.js".source = cfg.package.plugin;
          };
        };
    }
    // flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
        inherit (pkgs) lib;
      in
      {
        # The npm package as installed: dist/ beside skills/, which is where
        # the plugin looks for its skill. `.plugin` is the file to load.
        packages.default = pkgs.buildNpmPackage (finalAttrs: {
          pname = "octrimmer";
          version = (lib.importJSON ./package.json).version;
          src = lib.fileset.toSource {
            root = ./.;
            fileset = lib.fileset.unions [
              ./package.json
              ./package-lock.json
              ./index.ts
              ./lib
              ./skills
              ./tsconfig.json
              ./tsup.config.ts
              ./README.md
              ./LICENSE
            ];
          };
          # Read straight from the lock, so no hash goes stale on a bump.
          npmDeps = pkgs.importNpmLock { npmRoot = finalAttrs.src; };
          npmConfigHook = pkgs.importNpmLock.npmConfigHook;
          # package.json carries no scripts; the Justfile's `build` is this.
          dontNpmBuild = true;
          buildPhase = ''
            runHook preBuild
            npx tsup --silent
            runHook postBuild
          '';
          passthru.plugin = "${finalAttrs.finalPackage}/lib/node_modules/octrimmer/dist/index.js";
          meta = {
            description = "Manual context trimmer for opencode";
            homepage = "https://github.com/mlavrinenko/octrimmer";
            license = lib.licenses.mit;
          };
        });

        checks.default = self.packages.${system}.default;

        devShells.default = pkgs.mkShell {
          nativeBuildInputs = [
            # npm >= 11.5.1, for trusted publishing from .github/workflows/release.yml.
            pkgs.nodejs_24
            pkgs.just
            # `just e2e` reads opencode's JSON event stream and the trim
            # records back with jq; shellcheck keeps the script it lives in
            # under the same gate as the TypeScript.
            pkgs.jq
            pkgs.shellcheck
            # Lints .github/workflows, shellchecking their run: steps too.
            pkgs.actionlint
            # Scans every commit for secrets before the repo or npm sees them.
            pkgs.gitleaks
            # The Rust jscpd port, prebuilt on qahq's Cachix.
            qahq.packages.${system}.jscpd
            # README.md is rendered from docs/readme.typ by typlite, which
            # ships inside tinymist.
            pkgs.tinymist
            # Flags prose the code can outgrow; see outdatty.yaml.
            qahq.packages.${system}.outdatty
          ];
        };
      }
    );
}