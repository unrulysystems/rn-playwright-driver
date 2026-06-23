# Fallback for non-flake Nix users. flake-compat is pinned to the SAME revision as
# flake.lock (read from it here) so `nix-shell` evaluates the locked code — not a
# moving `master` tarball, which could change upstream or inject a shellHook into
# developer shells outside the lockfile.
let
  lock = builtins.fromJSON (builtins.readFile ./flake.lock);
  flakeCompat = lock.nodes.flake-compat.locked;
in
(import (fetchTarball {
  url = "https://github.com/${flakeCompat.owner}/${flakeCompat.repo}/archive/${flakeCompat.rev}.tar.gz";
  sha256 = flakeCompat.narHash;
}) {
  src = ./.;
}).shellNix
