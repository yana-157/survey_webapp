var map; 

// Replace this manually in Qualtrics with your public pk token.
// Do not commit a real Mapbox token to GitHub.
var MAPBOX_TOKEN = "PASTE_PUBLIC_MAPBOX_TOKEN_HERE";

var SPECIFICATION = "https://yana-157.github.io/neighborhood-survey/assets/wilkinsburg.json";
var ADJACENCY_GRAPH = "https://yana-157.github.io/neighborhood-survey/assets/wilkinsburg_graph.json";

Qualtrics.SurveyEngine.addOnload(function() {
    this.disableNextButton();

    map = window.MapDraw("#ns__container", {
        token: MAPBOX_TOKEN,
        url: SPECIFICATION,
        graph: ADJACENCY_GRAPH,
        errors: showError,
        allowProceed: (function(allow) {
            if (allow) this.enableNextButton();
            else this.disableNextButton();
        }).bind(this)
    });
});

Qualtrics.SurveyEngine.addOnReady(function() {
    function addressSearch() {
        var box = jQuery("#ns__address-box")
        var query = box.val();
        if (query.trim() == "") return;

        Qualtrics.SurveyEngine.setEmbeddedData("home_address", query.trim());
        map.loadAddress(query, box[0]);
    }

    jQuery("#ns__address-go").on("click", addressSearch);
    jQuery("#ns__address-box").on("keydown", function(e) {
        if (e.keyCode == 13) {
            e.preventDefault();
            addressSearch();
        }
    });
});

Qualtrics.SurveyEngine.addOnPageSubmit(function() {
    Qualtrics.SurveyEngine.setEmbeddedData("neighborhood", map.getNeighborhood());
});

