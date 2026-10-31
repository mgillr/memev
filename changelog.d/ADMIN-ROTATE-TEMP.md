### Security

- `memev token rotate` on the admin token removes the `.memev/admin.json.tmp` an interrupted rotate by an earlier version could leave behind, readable by others and possibly holding an old admin secret.
