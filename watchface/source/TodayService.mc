// Hämtar dagens pass från Träningsnavet i bakgrunden.
//
// Anropet går via Garmin Connect-appen i telefonen, så klockan måste vara
// parkopplad och appen igång. Svaret är litet: {"date": "2026-11-01",
// "text": "Tröskel 6x3min"} — bakgrundsprocessen har bara några kB minne.

import Toybox.Background;
import Toybox.Communications;
import Toybox.Lang;
import Toybox.PersistedContent;
import Toybox.System;

(:background)
class TodayService extends System.ServiceDelegate {

    const URL = "https://training-app-eta-two.vercel.app/api/watch/today";

    function initialize() {
        ServiceDelegate.initialize();
    }

    function onTemporalEvent() {
        Communications.makeWebRequest(
            URL,
            { "token" => Token.VALUE },
            {
                :method => Communications.HTTP_REQUEST_METHOD_GET,
                :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
            },
            method(:onResponse)
        );
    }

    function onResponse(
        code as Number,
        data as Null or ByteArray or Dictionary or String or PersistedContent.Iterator
    ) as Void {
        if (code == 200 && data instanceof Dictionary && data["text"] != null) {
            Background.exit({ "d" => data["date"], "t" => data["text"] });
        } else {
            Background.exit(null);
        }
    }
}
