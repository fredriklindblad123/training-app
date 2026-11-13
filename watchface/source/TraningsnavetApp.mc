// IFK-urtavlan: klubbemblemet stort i mitten, tiden ovanför och datumet under.
//
// Hämtar ingenting — ingen nätverkstrafik, ingen nyckel. Samma fil fungerar
// därför för alla med samma klockmodell. (Fram till 2026-11-02 visade den
// även dagens pass från Träningsnavet; borttaget på begäran.)

import Toybox.Application;
import Toybox.Lang;
import Toybox.WatchUi;

class TraningsnavetApp extends Application.AppBase {

    function initialize() {
        AppBase.initialize();
    }

    function getInitialView() {
        return [new WatchFaceView()];
    }
}
