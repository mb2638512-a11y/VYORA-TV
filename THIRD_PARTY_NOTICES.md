# Third-party notices

## StevenBlack/hosts data

VYORA Browser can download the hosts-format blocklist from:

- Project: https://github.com/StevenBlack/hosts
- Data URL: https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts
- License reported by the upstream GitHub repository: MIT
- Use in VYORA: hostnames are parsed into a bounded in-memory set and matched against browser subresource requests. Top-level navigations are never blocked by this implementation.

The list is refreshed asynchronously and cached locally. If downloading or parsing fails, the browser fails open and continues using its cached rules (or no rules if no cache exists).

The MIT license for the upstream project is available at https://github.com/StevenBlack/hosts/blob/master/LICENSE. This notice covers the downloaded host-list data only; it does not grant rights to unrelated browser source code or binaries.
