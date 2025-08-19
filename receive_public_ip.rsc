:local BASE "https://YOUR_SUBDOMAIN.workers.dev"
:local DEVICES {"YOUR_ROUTER_NAME_1";"YOUR_ROUTER_NAME_2"}

:foreach d in=$DEVICES do={
    :local url ($BASE . "/device/" . $d)
    :local tmp ("dev_" . $d . ".tmp")
    :local ip ""

    # Fetch and process IP
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

    # Process if we got a valid IP
    :if ([:len $ip] > 0) do={
        :local deviceTag ("device:" . $d)
        :local currentEntry [/ip firewall address-list find where list="senders-allow" and comment=$deviceTag]
        
        :if ([:len $currentEntry] > 0) do={
            # Entry exists - check if IP changed
            :local currentIP [/ip firewall address-list get $currentEntry address]
            :if ($currentIP != $ip) do={
                # IP changed - update entry
                :do {
                    /ip firewall address-list set $currentEntry address=$ip timeout=2m
                    :log info ("recv-ip: updated " . $d . " from " . $currentIP . " to " . $ip)
                } on-error={
                    :log warning ("recv-ip: failed to update " . $d . " (" . $ip . ")")
                }
            } else={
                # Same IP - just reset timeout
                /ip firewall address-list set $currentEntry timeout=2m
                :log debug ("recv-ip: same IP for " . $d . " (" . $ip . "), reset timeout")
            }
        } else={
            # No entry exists - add new one
            :do {
                /ip firewall address-list add list="senders-allow" \
                    address=$ip \
                    timeout=2m \
                    comment=$deviceTag
                :log info ("recv-ip: added new " . $d . " (" . $ip . ")")
            } on-error={
                :log warning ("recv-ip: failed to add " . $d . " (" . $ip . ")")
            }
        }
    }
}
