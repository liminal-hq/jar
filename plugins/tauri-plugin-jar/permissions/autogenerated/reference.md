## Default Permission

Default permissions for the jar simulation plugin. Grants every command the app itself needs — this plugin is not exposed to any untrusted webview content, so a broad default is appropriate here (contrast with a plugin embedding third-party web content, which should default to nothing and opt in per command).

#### This default permission set includes the following:

- `allow-start`
- `allow-stop`
- `allow-set-speed`
- `allow-set-habitat`
- `allow-add-critter`
- `allow-rename-critter`
- `allow-set-toggle`
- `allow-set-theme`
- `allow-set-frame`
- `allow-set-light-colour`
- `allow-set-light-intensity`
- `allow-set-bubble-intensity`
- `allow-get-snapshot`
- `allow-load-snapshot`
- `allow-reset-settings`
- `allow-reset-jar`

## Permission Table

<table>
<tr>
<th>Identifier</th>
<th>Description</th>
</tr>


<tr>
<td>

`jar:allow-add-critter`

</td>
<td>

Enables the add_critter command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`jar:deny-add-critter`

</td>
<td>

Denies the add_critter command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`jar:allow-get-snapshot`

</td>
<td>

Enables the get_snapshot command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`jar:deny-get-snapshot`

</td>
<td>

Denies the get_snapshot command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`jar:allow-load-snapshot`

</td>
<td>

Enables the load_snapshot command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`jar:deny-load-snapshot`

</td>
<td>

Denies the load_snapshot command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`jar:allow-rename-critter`

</td>
<td>

Enables the rename_critter command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`jar:deny-rename-critter`

</td>
<td>

Denies the rename_critter command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`jar:allow-reset-jar`

</td>
<td>

Enables the reset_jar command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`jar:deny-reset-jar`

</td>
<td>

Denies the reset_jar command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`jar:allow-reset-settings`

</td>
<td>

Enables the reset_settings command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`jar:deny-reset-settings`

</td>
<td>

Denies the reset_settings command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`jar:allow-set-bubble-intensity`

</td>
<td>

Enables the set_bubble_intensity command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`jar:deny-set-bubble-intensity`

</td>
<td>

Denies the set_bubble_intensity command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`jar:allow-set-frame`

</td>
<td>

Enables the set_frame command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`jar:deny-set-frame`

</td>
<td>

Denies the set_frame command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`jar:allow-set-habitat`

</td>
<td>

Enables the set_habitat command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`jar:deny-set-habitat`

</td>
<td>

Denies the set_habitat command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`jar:allow-set-light-colour`

</td>
<td>

Enables the set_light_colour command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`jar:deny-set-light-colour`

</td>
<td>

Denies the set_light_colour command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`jar:allow-set-light-intensity`

</td>
<td>

Enables the set_light_intensity command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`jar:deny-set-light-intensity`

</td>
<td>

Denies the set_light_intensity command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`jar:allow-set-speed`

</td>
<td>

Enables the set_speed command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`jar:deny-set-speed`

</td>
<td>

Denies the set_speed command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`jar:allow-set-theme`

</td>
<td>

Enables the set_theme command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`jar:deny-set-theme`

</td>
<td>

Denies the set_theme command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`jar:allow-set-toggle`

</td>
<td>

Enables the set_toggle command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`jar:deny-set-toggle`

</td>
<td>

Denies the set_toggle command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`jar:allow-start`

</td>
<td>

Enables the start command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`jar:deny-start`

</td>
<td>

Denies the start command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`jar:allow-stop`

</td>
<td>

Enables the stop command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`jar:deny-stop`

</td>
<td>

Denies the stop command without any pre-configured scope.

</td>
</tr>
</table>
