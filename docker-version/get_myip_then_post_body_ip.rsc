# RouterOS script (sender)
# Optional compatibility mode:
# 1) GET /myip (icanhazip-like endpoint hosted on your server)
# 2) POST IP to /device/<name>
# Use this only if you specifically want to keep "get ip then post" flow.

:local BASE_URL "https://cloud.x.com/routeros-live-ip-registry"
:local ROUTER_NAME [/system identity get name]
:local TOKEN "YOUR_LONG_RANDOM_TOKEN"

:local ip ""

:do {
    :local r [/tool fetch url=($BASE_URL . "/myip") output=user as-value]
    :set ip ($r->"data")
} on-error={
    :log warning "get-myip: FAILED"
}

:if ($ip != "") do={
    :local url ($BASE_URL . "/device/" . $ROUTER_NAME)
    /tool fetch url=$url http-method=post http-header-field=("Authorization: Bearer " . $TOKEN) http-data=("ip=" . $ip) output=none keep-result=no
}
