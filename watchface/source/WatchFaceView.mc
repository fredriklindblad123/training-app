// Urtavlans ritning: emblemet överst, tiden i mitten, datum under, och
// dagens pass längst ned.

import Toybox.Application;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.Time;
import Toybox.Time.Gregorian;
import Toybox.WatchUi;

class WatchFaceView extends WatchUi.WatchFace {

    // IFK-gult för rubriken "Idag". MIP-skärmarna på fenix 5/6 har en
    // begränsad palett och väljer närmaste färg.
    const IFK_YELLOW = 0xFFCC00;
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

        // Emblemet
        dc.drawBitmap((w - emblem.getWidth()) / 2, (h * 0.07).toNumber(), emblem);

        // Tiden
        var clock = System.getClockTime();
        var time = clock.hour.format("%02d") + ":" + clock.min.format("%02d");
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, (h * 0.47).toNumber(), Graphics.FONT_NUMBER_MEDIUM, time,
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        // Datum
        var now = Gregorian.info(Time.now(), Time.FORMAT_SHORT);
        var date = DAYS[now.day_of_week - 1] + " " + now.day + "/" + now.month;
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, (h * 0.62).toNumber(), Graphics.FONT_SMALL, date,
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        // Dagens pass
        dc.setColor(IFK_YELLOW, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, (h * 0.72).toNumber(), Graphics.FONT_XTINY, "IDAG",
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        var text = todayText(now);
        var boxW = (w * 0.7).toNumber();
        var boxH = (h * 0.16).toNumber();
        if (Graphics has :fitTextToArea) {
            text = Graphics.fitTextToArea(text, Graphics.FONT_TINY, boxW, boxH, true);
        }
        dc.drawText(w / 2, (h * 0.83).toNumber(), Graphics.FONT_TINY, text,
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    // Senast hämtade pass — men bara om det gäller idag. Strax efter midnatt
    // står gårdagens kvar tills nästa hämtning, och det ska inte visas som
    // dagens.
    function todayText(now) {
        var stored = Application.Storage.getValue("today");
        if (!(stored instanceof Dictionary)) {
            return "Hämtar...";
        }
        var key = now.year.format("%04d") + "-" + now.month.format("%02d") + "-" + now.day.format("%02d");
        if (!key.equals(stored["d"])) {
            return "Hämtar...";
        }
        return stored["t"];
    }
}
