# RouterOS script (sender)
# Updates registry by calling /push (registry stores the source/public IP as seen by the server).
# No external "what is my IP" service is needed.

:local BASE_URL "https://cloud.x.com/routeros-live-ip-registry"
:local ROUTER_NAME [/system identity get name]
:local TOKEN "YOUR_LONG_RANDOM_TOKEN"

:local URL ($BASE_URL . "/device/" . $ROUTER_NAME . "/push?token=" . $TOKEN)

:local timestamp ([/system clock get date] . " " . [/system clock get time])

:do {
    /tool fetch url=$URL output=none keep-result=no
    :log info ("[" . $timestamp . "] push-live-ip: OK")
} on-error={
    :log warning ("[" . $timestamp . "] push-live-ip: FAILED")
}

# schedule every 30 seconds
/system scheduler add name=push-live-ip interval=30s on-event="/system script run push-live-ip" disabled=no
