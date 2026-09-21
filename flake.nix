{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    utils.url = "github:numtide/flake-utils";
  };
  outputs =
    {
      self,
      nixpkgs,
      utils,
    }:
    utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        src = self;
        npmRoot = self;
        hbt = pkgs.buildNpmPackage {
          pname = "hbt";
          version = "0.1.0";
          inherit src;

          npmDeps = pkgs.importNpmLock { inherit npmRoot; };

          npmConfigHook = pkgs.importNpmLock.npmConfigHook;
        };
      in
      {
        packages.default = hbt;
        devShell = pkgs.mkShell {
          packages = with pkgs; [
            importNpmLock.hooks.linkNodeModulesHook
            nodejs
          ];
          npmDeps = pkgs.importNpmLock.buildNodeModules {
            inherit npmRoot;
            inherit (pkgs) nodejs;
          };
        };
      }
    );
}
