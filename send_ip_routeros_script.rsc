# Script: Public IP Update for Cloudflare Workers
# Author: zalaghi
# Created: 2025-08-19 21:03:50
# Last Modified: 2025-08-19 21:03:50

:local URL "https://routeros-live-ip-registry.amir-2ce.workers.dev/device/unit51"
:local TOKEN "X3IIYoBmIGciS4odwSD0CWz3XR7O6PMU"
:local ip ""

# Get timestamp for logging
:local timestamp ([/system clock get date] . " " . [/system clock get time])

# Try to get public IP with simple fetch command
:do {
    :local result [/tool fetch url="http://ifconfig.me/ip" output=user as-value]
    :set ip ($result->"data")
} on-error={
    :log debug ("[" . $timestamp . "] Failed to fetch IP from ifconfig.me")
}

# If first attempt failed, try backup service
:if ([:len $ip] = 0) do={
    :do {
        :local result [/tool fetch url="http://ipv4.icanhazip.com" output=user as-value]
        :set ip ($result->"data")
    } on-error={
        :log debug ("[" . $timestamp . "] Failed to fetch IP from icanhazip.com")
    }
}

# Clean the IP string - remove any whitespace or newlines
:if ([:len $ip] > 0) do={
    # Remove trailing whitespace and newlines
    :local newip ""
    :local chars [:len $ip]
    :for i from=0 to=($chars - 1) do={
        :local char [:pick $ip $i]
        :if ($char != "\r" && $char != "\n" && $char != " ") do={
            :set newip ($newip . $char)
        }
    }
    :set ip $newip
}

# Verify we have a valid IP
:if ([:len $ip] > 0) do={
    :do {
        :set ip [:tostr [:toip $ip]]
    } on-error={
        :set ip ""
    }
}

# Final check before sending
:if ([:len $ip] = 0) do={
    :log warning ("[" . $timestamp . "] post-live-ip: Failed to get valid public IP address")
    :return
}

# Send the update
:do {
    /tool fetch http-method=post url=$URL http-data=$ip http-header-field=("Authorization: Bearer " . $TOKEN) output=none
    :log info ("[" . $timestamp . "] Successfully updated public IP: " . $ip)
} on-error={
    :log warning ("[" . $timestamp . "] Failed to send update for public IP: " . $ip)
}