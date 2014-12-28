/*jslint browser: true*/
/*global $, jQuery, alert*/
var currentWeights = {};
var teamsByName = {};
var teamsByRegion = [[], [], [], []];
var teamsById = {};
var headers = [];

// RegionIDs in the csv are the associated array indeces for teamsByRegion
var regions = ["South", "East", "West", "Midwest"];

/* This logic will need to be rewritten for 2015. Currently using 2014's First Four placement */
var firstFours = [];


$(function() {
    
    $.get("2015-data.csv", function(data) {
      // array of regions, each representing hashmaps representing seed numbers
      // used for determining first four matchups.
      var teamsByRegionAndSeed = [{}, {}, {}, {}];
      var lines = data.split("\n");
      var result = [];
      headers = lines[0].trim().split(",");

      for (var i = 1; i < lines.length; i++) {
        var currentLine = lines[i].split(",");
        var team = {};
        for (var j = 0; j < headers.length; j++) {
          team[attrToID(headers[j])] = currentLine[j];
        }
        team['Random'] = Math.random() * 100; // TODO: make this on submit() rather than page load
        teamsByName[team['Name']] = team;
        teamsById[team['Id']] = team;
        teamsByRegion[team['Region']].push(team);
        //console.log(team);
        if(team['Seed'] in teamsByRegionAndSeed[team['Region']]) {
            team['FirstFour'] = true;
            teamsByRegionAndSeed[team['Region']][team['Seed']]['FirstFour'] = true;
            firstFours.push([team, teamsByRegionAndSeed[team['Region']][team['Seed']]]);
        } else {
            team['FirstFour'] = false;            
            teamsByRegionAndSeed[team['Region']][team['Seed']] = team;        
        }
        
      }

      headers.push('Random');
      $.each(headers, function(i, param) {
        var id = attrToID(param);
        if(id == "Region" || id == "Name" || id == "Id") return true;
        
        currentWeights[id] = 0;
        $('#sliders').append('<li><label for="' + id + '">' + param + '</label><div id="' + id + '"></div></li>');
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


  for(var matchupId in firstFours) {
    matchup = firstFours[matchupId];
    $('#first-four').append('<li id="FirstFour' + matchupId + '">' + regions[matchup[0]['Region']] + ' (' + matchup[0]['Seed'] + '): ' + matchup[0]['Name'] + ' vs ' + matchup[1]['Name'] + '<div id="FirstFour' + matchupId + 'Result" style="font-weight:bold;display:inline;"></div></li>');
  }

    
  for(var regionID = 0; regionID < regions.length; regionID++) {
      region = regions[regionID];
      var list = $('<ul/>');
      
      for(var teamId in teamsByRegion[regionID]) {
        team = teamsByRegion[regionID][teamId];
        if(!team['FirstFour']) {
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
function getWinner(weights, team1, team2) {
    team1Total = 0;
    team2Total = 0;
    for(weightName in weights) {
        weight = weights[weightName];
        if(weightName == 'Seed') {
            // Higher seeds are worse, so invert the value range
            team1Total += (17 - team1[weightName]) * weight;
            team2Total += (17 - team2[weightName]) * weight;
        } else {
            team1Total += team1[weightName] * weight;
            team2Total += team2[weightName] * weight;
        }
    }
    return team1Total > team2Total ? team1 : team2;
}

function submit() {
    var totalWeight = 0;
    $.each(headers, function(i, param) {
        var id = attrToID(param);
        if(id == "Region" || id == "Name" || id == "Id") return true;
        totalWeight += currentWeights[id];
    });
    relativeWeights = {};
    $.each(currentWeights, function(param) {
        var id = attrToID(param);
        relativeWeights[param] = (currentWeights[param] / totalWeight).toFixed(3);
    });
    $('#bracket').text(JSON.stringify(relativeWeights, undefined, 2));
    
    
    for(matchupID in firstFours) {
        $('#FirstFour' + matchupID + 'Result').text("Winner: " + getWinner(relativeWeights, firstFours[matchupID][0], firstFours[matchupID][1])['Name']);
    }
    var team1 = teamsById[0];
    var team2 = teamsById[1];
    var winner = getWinner(relativeWeights, team1, team2);
    console.log("winner between " + team1['Name'] + " and " + team2['Name'] + ": " + winner['Name']);
}

function attrToID(attr) {
    return attr.replace(/ /g, "");
}