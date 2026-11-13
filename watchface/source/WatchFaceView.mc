// Ritningen: tiden överst, emblemet i mitten (halva skärmhöjden, en egen
// bildstorlek per skärm i resources-round-*), datumet underst.

import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.Time;
import Toybox.Time.Gregorian;
import Toybox.WatchUi;

class WatchFaceView extends WatchUi.WatchFace {

    const DAYS = ["sön", "mån", "tis", "ons", "tor", "fre", "lör"];

    var emblem;

    function initialize() {
        WatchFace.initialize();
    }

    function onLayout(dc) {
        emblem = WatchUi.loadResource(Rez.Drawables.Emblem);
    }

    function onUpdate(dc) {
        var w = dc.getWidth();
        var h = dc.getHeight();

        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();

        // Emblemet, centrerat
        dc.drawBitmap((w - emblem.getWidth()) / 2, (h - emblem.getHeight()) / 2, emblem);

        // Tiden, i bandet ovanför emblemet
        var clock = System.getClockTime();
        var time = clock.hour.format("%02d") + ":" + clock.min.format("%02d");
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, (h * 0.14).toNumber(), Graphics.FONT_NUMBER_MILD, time,
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        // Datumet, i bandet under emblemet
        var now = Gregorian.info(Time.now(), Time.FORMAT_SHORT);
        var date = DAYS[now.day_of_week - 1] + " " + now.day + "/" + now.month;
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, (h * 0.87).toNumber(), Graphics.FONT_SMALL, date,
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }
}
