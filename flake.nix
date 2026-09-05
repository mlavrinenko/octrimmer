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
      flake-utils,
      nixpkgs,
      qahq,
      ...
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        devShells.default = pkgs.mkShell {
          nativeBuildInputs = [
            pkgs.nodejs_22
            pkgs.just
            # The Rust jscpd port, prebuilt on qahq's Cachix.
            qahq.packages.${system}.jscpd
          ];
        };
      }
    );
}