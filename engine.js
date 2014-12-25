/*jslint browser: true*/
/*global $, jQuery, alert*/
var currentWeights = {};
var attributes = {"conf": "Conference", "dd": "# of DD players", "fgp": "Field-Goal Percentage", "sm": "Scoring Margin", "sd": "Scoring Defense", "atr": "Assists/Turnover Ratio", "tm": "Turnover Margin", "ftp": "Free-Throw Percentage", "or": "Offensive Rebounds", "rm": "Rebound Margin", "seed": "Seed", "pr": "Power Ranking", "r": "Random"};
var teamData = {};
$(function() {
    $.each(attributes, function(id, name) {
        if(id == "conf") return true;
        
        currentWeights[id] = 0;
        $('#sliders').append('<li><label for="' + id + '">' + name + '</label><div id="' + id + '"></div></li>');
        $('#' + id).slider({
            value: 0,
            range: "min",
            animate: true,
            slide: function(event, ui) {
                currentWeights[$(this).attr('id')] = ui.value;
            }
        });
    });
    $.get("data.csv", function(data) {
      var lines = data.split("\n");
      var result = [];
      var headers = lines[0].split(",");
      for (var i = 1; i < lines.length; i++) {
        var currentLine = lines[i].split(",");
        var name = currentLine[0];
        teamData[name] = {};
        for (var j = 1; j < headers.length; j++) {
          teamData[name][headers[j]] = currentLine[j];
        }
      }
    });
});

function submit() {
    var totalWeight = 0;
    $.each(attributes, function(param, name) {
            if(param == "conf") return true;

        totalWeight += currentWeights[param];
    });
    relativeWeights = {};
    $.each(currentWeights, function(param) {
        relativeWeights[param] = (currentWeights[param] / totalWeight).toFixed(3);
    });
    /*console.log(relativeWeights);*/
    $('#teams').text(JSON.stringify(relativeWeights));
}

