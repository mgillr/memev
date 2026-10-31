### Security

- No token writes the bus's own files under `bus/`, in any letter case; only the bus writes its messages, seats and lead record. Before, a cloud connector token, whose folders include `bus/`, could make itself the lead and give a local seat the alias `operator` with ordinary note writes, and a runner turned on for that seat then ran the cloud's text.
