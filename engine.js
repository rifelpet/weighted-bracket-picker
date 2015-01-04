/*jslint browser: true*/
/*global $, jQuery, alert*/
var currentWeights = {};
var teamsByName = {};
var teamsByRegion = [[], [], [], []];

// array of regions, each representing hashmaps representing seed numbers
// Does not contain losers of first-four matchups.
var bracketTeamsByRegionAndSeed = [{}, {}, {}, {}];
var teamsById = {};
var headers = [];

// RegionIDs in the csv are the associated array indeces for teamsByRegion
var regions = ["South", "East", "West", "Midwest"];

/* This logic will need to be rewritten for 2015. Currently using 2014's First Four placement */
var firstFours = [];


$(function() {
    
    $.get("2015-data.csv", function(data) {

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
        if(team['Seed'] in bracketTeamsByRegionAndSeed[team['Region']]) {
            firstFours.push([team, bracketTeamsByRegionAndSeed[team['Region']][team['Seed']]]);
            delete bracketTeamsByRegionAndSeed[team['Region']][team['Seed']];
        } else {
            bracketTeamsByRegionAndSeed[team['Region']][team['Seed']] = team;        
        }
        
      }
      //console.log(teamsByRegion);

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
      var region = regions[regionID];
      var list = $('<ul/>');
      regionTeams = bracketTeamsByRegionAndSeed[regionID];
      
      for(var seed = 1; seed < 9; seed++) {
        var high = regionTeams[seed];
        var lowString = '';
        if((17 - seed) in regionTeams) {
            var lowTeam = regionTeams[17 - seed];
            lowString = '(' + lowTeam['Seed'] + ') ' + lowTeam['Name'];
            $('#' + region.toLowerCase() + 'seed' + lowTeam['Seed']).text('(' + lowTeam['Seed'] + ') ' + lowTeam['Name']);    
        } else {
            $('#' + region.toLowerCase() + 'seed' + (17 - seed)).html('(' + (17 - seed) + ') <i>First 4 winner</i>');
        }
        $('#' + region.toLowerCase() + 'seed' + high['Seed']).text('(' + high['Seed'] + ') ' + high['Name']);
        //list.append('<li>(' + high['Seed'] + ') ' + high['Name'] + ' vs ' + lowString + '</li>');
      }
      
      //$('#teams').append('<h4>' + region + '</h4>');
      //$('#teams').append(list);
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

function render_bracket_team(container, data, score) {
  if (!data['Name'])
    return;
  container.append(data['Name']);
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
    
    
    for(matchupID in firstFours) {
        var winner = getWinner(relativeWeights, firstFours[matchupID][0], firstFours[matchupID][1]);
        bracketTeamsByRegionAndSeed[winner['Region']][winner['Seed']] = winner;
        //console.log('#' + regions[winner['Region']].toLowerCase() + 'seed' + winner['Seed']);
        $('#' + regions[winner['Region']].toLowerCase() + 'seed' + winner['Seed']).text('(' + winner['Seed'] + ') ' + winner['Name']); 
        $('#FirstFour' + matchupID + 'Result').text("Winner: " + winner['Name']);
    }
    
    var gameWinnerRegions = [{}, {}, {}, {}];
    for(regionID in regions) {
    
        var currentRegion = bracketTeamsByRegionAndSeed[regionID];
        var gameWinners = gameWinnerRegions[regionID];
        var bracketData = {teams: [],
            scores: []
        };
        
        var region = regions[regionID].toLowerCase();
        
        // First round of 64
        for(var seed = 1; seed < 9; seed++) {
            
            var high = currentRegion[seed];
            var low = currentRegion[17 - seed];
            bracketData.teams.push(['(' + high['Seed'] + ') ' + high['Name'], '(' + low['Seed'] + ') ' + low['Name']]);
            
            var winner = getWinner(relativeWeights, high, low);
            gameWinners['game' + String(seed)] = winner;
            $('#' + region + 'game' + seed).text('(' + winner['Seed'] + ') ' + winner['Name']);
        }
        
        // Round of 32 through the Elite 8
        var gameDiff = 8;
        for(var game = 9; game < 16; game++) {
            var high = gameWinners['game' + String(game - gameDiff)];
            var low = gameWinners['game' + String(game + 1 - gameDiff)];
            var winner = getWinner(relativeWeights, high, low);
            gameWinners['game' + String(game)] = winner;
            $('#' + region + 'game' + game).text('(' + winner['Seed'] + ') ' + winner['Name']);
            gameDiff--;
        }  
    }
    
    // Final four and championship game
    var regionID = 0;
    var sides = ["left", "right"];
    for(side in sides) {
        console.log(gameWinnerRegions);
        console.log(regionID);
        var team1 = gameWinnerRegions[regionID++]["game15"];
        var team2 = gameWinnerRegions[regionID++]["game15"];
        var winner = getWinner(relativeWeights, team1, team2);
        console.log('#' + sides[side] + 'game');
        $('#' + sides[side] + 'game').text('(' + winner['Seed'] + ') ' + winner['Name']);
    }
    
    
}



function attrToID(attr) {
    return attr.replace(/ /g, "");
}