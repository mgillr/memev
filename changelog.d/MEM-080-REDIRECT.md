### Fixed

- A redirect followed through a proxy now drops what fetch drops: Authorization, cookies and Proxy-Authorization on a hop to another origin, and the body headers when a POST becomes a GET. Before, they went on to the next server unchanged.
