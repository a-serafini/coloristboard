export async function onRequestGet(context) {
    let cachedData = {
        name: 'The Colorist',
        town: 'Meilen',
        street: 'Dorfstrasse 81',
        zip: '8706',
        website: 'thecolorist.ch',
        bookingUrl: 'thecolorist.belbo.com/termin',
        hours: [10, 11, 12, 13, 14, 15, 16, 17, 18],
        openTime: '10:00',
        closeTime: '18:00',
        primaryColor: '#79BD74',
        lastUpdate: null,
        locationImage: null,
        employees: [],
    };

    // Calculate isOpen based on Swiss time
    const zurichTimeStr = new Date().toLocaleString("en-US", { timeZone: "Europe/Zurich" });
    const now = new Date(zurichTimeStr);
    const hour = now.getHours();
    const day = now.getDay(); // 0=Sun
    const isOpen = day >= 2 && day <= 6 && hour >= 10 && hour < 18;

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => { controller.abort(); }, 5000);
        
        const [locResp, settingsResp] = await Promise.all([
            fetch('https://thecolorist.belbo.com/externalBooking/availableLocations', {
                headers: { 'Accept': 'application/json' },
                signal: controller.signal,
            }).catch(() => null),
            fetch('https://thecolorist.belbo.com/mobileData/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'locale=de',
                signal: controller.signal,
            }).catch(() => null)
        ]);

        if (locResp && locResp.ok) {
            const locData = await locResp.json();
            const loc = locData.locations?.[0];
            if (loc) {
                cachedData.name = loc.name || cachedData.name;
                cachedData.town = loc.address?.town || cachedData.town;
                cachedData.street = `${loc.address?.street || ''} ${loc.address?.houseNumber || ''}`.trim() || cachedData.street;
                cachedData.zip = loc.address?.zip || cachedData.zip;
                cachedData.website = (loc.websiteUrl || '').replace(/^https?:\/\//, '') || cachedData.website;
                cachedData.locationImage = loc.primaryImage?.['500x500'] || loc.primaryImage?.original || null;
            }
        }

        if (settingsResp && settingsResp.ok) {
            const settings = await settingsResp.json();
            cachedData.name = settings.accountName || cachedData.name;
            if (settings.primaryGradientTop?.hex) {
                cachedData.primaryColor = settings.primaryGradientTop.hex;
            }
        }

        // --- Fetch Real Employees (Requires ephemeral session) ---
        let initialCookies = [];
        const terminResp = await fetch('https://thecolorist.belbo.com/termin', { signal: controller.signal }).catch(() => null);
        
        if (terminResp) {
            const rawCookies = terminResp.headers.getSetCookie ? terminResp.headers.getSetCookie() : [terminResp.headers.get('set-cookie') || ''];
            for (const rc of rawCookies) {
                if (rc && rc.includes('SESSION=')) initialCookies.push(rc.split(';')[0]);
            }
        }

        if (initialCookies.length > 0) {
            const bpResp = await fetch('https://thecolorist.belbo.com/externalBooking/bookingProcess', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Cookie': initialCookies.join('; '), 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
                body: JSON.stringify({ groupId: 4566, locationId: 4566, locale: 'de' }),
                signal: controller.signal
            }).catch(() => null);

            if (bpResp) {
                const bpCookies = bpResp.headers.getSetCookie ? bpResp.headers.getSetCookie() : [bpResp.headers.get('set-cookie') || ''];
                let activeCookies = [...initialCookies];
                for (const bc of bpCookies) {
                    if (bc && bc.includes('SESSION=')) activeCookies[0] = bc.split(';')[0];
                }

                const srvResp = await fetch('https://thecolorist.belbo.com/newAppointment/calcServicersAPI', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Cookie': activeCookies.join('; '), 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
                    body: JSON.stringify({
                        appointmentMoveTokenPlain: '',
                        groupId: 4566,
                        selectedProducts: [654799],
                        landingPage: '',
                        locale: 'de',
                        bookingSource: ''
                    }),
                    signal: controller.signal
                }).catch(() => null);

                if (srvResp && srvResp.ok) {
                    const srvData = await srvResp.json();
                    if (srvData && srvData.model && srvData.model.listOfAnyServicers && srvData.model.listOfAnyServicers['0']) {
                        const servicers = srvData.model.listOfAnyServicers['0'];
                        cachedData.employees = servicers.map(s => (s.firstName || s.displayName)).filter(Boolean).slice(0, 4);
                    }
                }
            }
        }
        clearTimeout(timeout);
    } catch(e) {
        console.error("Error fetching from Belbo in edge proxy", e);
    }

    cachedData.lastUpdate = new Date().toISOString();

    const result = {
        ...cachedData,
        isOpen,
        currentTime: new Date().toISOString(),
    };

    return new Response(JSON.stringify(result), {
        headers: {
            "Content-Type": "application/json;charset=UTF-8",
            "Cache-Control": "public, max-age=300",
            "Access-Control-Allow-Origin": "*"
        }
    });
}
