// IFK-urtavlan för Träningsnavet: emblem, tid, datum och dagens pass.
//
// Dagens pass hämtas i bakgrunden (TodayService) ungefär var 15:e minut via
// telefonen, och sparas i Application.Storage så att urtavlan kan rita det
// utan att själv göra nätverksanrop.

import Toybox.Application;
import Toybox.Background;
import Toybox.Lang;
import Toybox.System;
import Toybox.Time;
import Toybox.WatchUi;

(:background)
class TraningsnavetApp extends Application.AppBase {

    function initialize() {
        AppBase.initialize();
    }

    function getInitialView() {
        if (System has :ServiceDelegate) {
            // Kortast tillåtna intervall är 5 min; 15 räcker för ett pass
            // som ändras högst några gånger per dag och sparar batteri.
            Background.registerForTemporalEvent(new Time.Duration(15 * 60));
        }
        return [new WatchFaceView()];
    }

    function getServiceDelegate() {
        return [new TodayService()];
    }

    // Bakgrundsprocessen lämnar {"d" => datum, "t" => text}, eller null när
    // hämtningen misslyckades — då står det senast kända kvar.
    function onBackgroundData(data) {
        if (data instanceof Dictionary) {
            Application.Storage.setValue("today", data);
            WatchUi.requestUpdate();
        }
    }
}
