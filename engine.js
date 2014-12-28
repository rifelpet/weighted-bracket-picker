/*jslint browser: true*/
/*global $, jQuery, alert*/
var currentWeights = {};
var teamDataByName = {};
var teamDataById = {};
var headers = [];

/* This logic will need to be rewritten for 2015. Currently using 2014's First Four placement */
var firstFour = [[0,33],[39,67],[6,55],[19,53]];
var firstRoundMatchUps = [[16, 1], [15, 2], [14, 3], [13, 4], [12, 5], [11, 6], [10, 7], [9, 8]];


$(function() {
    
    $.get("2015-data.csv", function(data) {
      var lines = data.split("\n");
      var result = [];
      headers = lines[0].trim().split(",");
      for (var i = 1; i < lines.length; i++) {
        var currentLine = lines[i].split(",");
        var name = currentLine[1];
        teamDataByName[name] = {};
        teamDataById[currentLine[0]] = {};
        for (var j = 0; j < headers.length; j++) {
          if(j != 1) teamDataByName[name][headers[j]] = currentLine[j];
          if(j != 0) teamDataById[currentLine[0]][headers[j]] = currentLine[j];
        }
      }
      
      $.each(headers, function(i, name) {
        id = attrToId(name);
        if(id == "Region" || id == "Name" || id == "Id") return true;
        
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
      setupInitialMatches();
      
    });
    
});

/*
 * Sets up the initial matchups based on seeding for a given region.
 * Any teams with identical seed numbers and regions are treated as a "First Four" match.
 */
function setupInitialMatches() {
  // RegionIDs in the csv are the associated array indeces + 1
  var regions = ["South", "East", "West", "Midwest"];
  var regionTeams = [[], [], [], []];
  
  for(var teamId in teamDataById) {
    team = teamDataById[teamId];
    regionTeams[team['Region'] - 1].push(team);
  }
    
  for(var regionID = 1; regionID < regions.length + 1; regionID++) {
      region = regions[regionID - 1];
      var list = $('<ul/>');
      
      // Used for detecting duplicate seeds for first four matches
      var teamsBySeed = {};
      
      for(var teamId in regionTeams[regionID - 1]) {
        team = regionTeams[regionID - 1][teamId];
        if(team['Seed'] in teamsBySeed) {
            $('#first-four').append('<li>' + region + ': ' + team['Name'] + ' vs ' + teamsBySeed[team['Seed']]['Name'] + '</li>');
        } else {
            teamsBySeed[team['Seed']] = team;
            list.append('<li>' + team['Seed'] + ': ' + team['Name'] + '</li>');
        }
          
      }
      
      $('#teams').append('<h4>' + region + '</h4>');
      $('#teams').append(list);
  }
}

/*
 * Determine the winner of a matchup based on weight. 
 * Return the team object for the winning team.
 */
function getWinner(team1, team2) {
    
}

function submit() {
    var totalWeight = 0;
    $.each(headers, function(i, name) {
        param = attrToId(name);
        if(param == "Region" || param == "Name" || param == "Id") return true;
        totalWeight += currentWeights[param];
    });
    relativeWeights = {};
    $.each(currentWeights, function(param) {
        relativeWeights[param] = (currentWeights[param] / totalWeight).toFixed(3);
    });
    $('#teams').text(JSON.stringify(relativeWeights));
}


function attrToId(attribute) {
    return attribute.replace(/ /g, "");
}