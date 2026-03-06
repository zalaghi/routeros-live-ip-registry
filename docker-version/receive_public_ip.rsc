# RouterOS script (receiver)
# Pulls IPs from registry and keeps a single address-list "senders-allow" updated.

:local BASE "http://YOUR_PUBLIC_HOST_OR_IP:8080"
:local DEVICES {"YOUR_ROUTER_NAME_1";"YOUR_ROUTER_NAME_2"}

:foreach d in=$DEVICES do={
    :local url ($BASE . "/device/" . $d)
    :local tmp ("dev_" . $d . ".tmp")
    :local ip ""

    :do {
        /tool fetch url=$url dst-path=$tmp
        :if ([:len [/file find name=$tmp]] > 0) do={
            :local content [/file get $tmp contents]
            /file remove $tmp
            :if ([:len $content] > 0) do={
                :local clean [:pick $content 0 [:find $content "\n"]]
                :set ip [:tostr [:toip $clean]]
            }
        }
    } on-error={
        :log warning ("recv-ip: fetch failed for " . $d)
    }

    :if ([:len $ip] > 0) do={
        :local deviceTag ("device:" . $d)
        :local currentEntry [/ip firewall address-list find where list="senders-allow" and comment=$deviceTag]

        :if ([:len $currentEntry] > 0) do={
            :local currentIP [/ip firewall address-list get $currentEntry address]
            :if ($currentIP != $ip) do={
                :do {
                    /ip firewall address-list set $currentEntry address=$ip timeout=2m
                    :log info ("recv-ip: updated " . $d . " from " . $currentIP . " to " . $ip)
                } on-error={
                    :log warning ("recv-ip: failed to update " . $d . " (" . $ip . ")")
                }
            } else={
                /ip firewall address-list set $currentEntry timeout=2m
                :log debug ("recv-ip: same IP for " . $d . " (" . $ip . "), reset timeout")
            }
        } else={
            :do {
                /ip firewall address-list add list="senders-allow" address=$ip timeout=2m comment=$deviceTag
                :log info ("recv-ip: added new " . $d . " (" . $ip . ")")
            } on-error={
                :log warning ("recv-ip: failed to add " . $d . " (" . $ip . ")")
            }
        }
    }
}

# schedule every 30 seconds
/system scheduler add name=pull-senders-ip interval=30s on-event="/system script run pull-senders-ip" disabled=no

# firewall rule example (place correctly in your ruleset)
/ip firewall filter add chain=input src-address-list=senders-allow action=accept comment="allow from live senders"
