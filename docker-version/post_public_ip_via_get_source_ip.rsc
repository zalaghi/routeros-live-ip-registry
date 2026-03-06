# RouterOS script (sender)
# Stores the router's *source/public IP* as seen by the registry (no external "what is my IP" service needed).

:local BASE_URL "http://YOUR_PUBLIC_HOST_OR_IP:8080"
:local ROUTER_NAME "YOUR_ROUTER_NAME"  # use /system identity name (sanitized to A-Za-z0-9_-)
:local TOKEN "YOUR_LONG_RANDOM_TOKEN"

:local URL ($BASE_URL . "/device/" . $ROUTER_NAME . "/push")

# Timestamp for logging
:local timestamp ([/system clock get date] . " " . [/system clock get time])

:do {
    /tool fetch url=$URL http-header-field=("Authorization: Bearer " . $TOKEN) output=none
    :log info ("[" . $timestamp . "] push-live-ip: OK")
} on-error={
    :log warning ("[" . $timestamp . "] push-live-ip: FAILED")
}

# schedule every 30 seconds
/system scheduler add name=push-live-ip interval=30s on-event="/system script run push-live-ip" disabled=no
