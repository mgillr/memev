### Security

- A remote computer's credential without a device key is refused on every request, even when its requests name a cloud AI app in their User-Agent. Before, one refused request with such a User-Agent switched the device to a cloud connector, and from then on the same keyless credential could read and write from anywhere. The User-Agent now only flags the device, and a record that an earlier version had already switched goes back to a computer at its next request; a cloud AI app gets its own connector link from `memev cloud url`.
