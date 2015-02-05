/*jslint browser: true*/
/*global $, jQuery, alert*/
var currentWeights = {};
var teamsByName = {};
var teamsByRegion = [
    [],
    [],
    [],
    []
];
// array of regions, each representing hashmaps representing seed numbers
// Does not contain losers of first-four matchups.
var bracketTeamsByRegionAndSeed = [{}, {}, {}, {}];

var headers = [];
// RegionIDs in the csv are the 'regions' indeces
var regions = ["South", "East", "West", "Midwest"];

// Headers that arent used in comparison for winner determination
var nonStatHeaders = ["Region", "Name", "Rank", "Games Won"];

var firstFours = [];
var year = "2014";

$(function() {
    // Grab values from the url if any
    var urlParams = {};
    location.search.substr(1).split("&").forEach(function(item) {
        var key = item.split("=")[0];
        urlParams[key] = decodeURIComponent(item.split("=")[1]).replace(/\//g, "");
    });
    if ("year" in urlParams) {
        year = urlParams.year;
        $('select[name="year"]').val(year);
    }
    $('#raw').attr('href', year + '-data.csv');
        
    $.get(year + "-data.csv", function(data) {
        var lines = data.trim().split("\n");
        var result = [];
        headers = lines[0].trim().split(",");
        for (var i = 1; i < lines.length; i++) {
            var currentLine = lines[i].split(",");
            var team = {};
            team.stats = {};
            for (var j = 0; j < headers.length; j++) {
                if(nonStatHeaders.indexOf(headers[j]) > -1) {
                    team[headers[j]] = currentLine[j];
                } else {
                    team.stats[attrToID(headers[j])] = currentLine[j];
                }
            }
            teamsByName[team.Name] = team;
            teamsByRegion[team.Region].push(team);
            if (team.stats.Seed in bracketTeamsByRegionAndSeed[team.Region]) {
                firstFours.push([team, bracketTeamsByRegionAndSeed[team.Region][team.stats.Seed]]);
                delete bracketTeamsByRegionAndSeed[team.Region][team.stats.Seed];
            } else {
                bracketTeamsByRegionAndSeed[team.Region][team.stats.Seed] = team;
            }
        }
        var initialSubmit = false;
        headers.push('Random');
        $.each(headers, function(i, param) {
            var id = attrToID(param);
            var initialVal = 0;
            if (id in urlParams) {
                initialVal = urlParams[id];
                initialSubmit = true;
            }
            if (nonStatHeaders.indexOf(id) > -1) return true;
            currentWeights[id] = initialVal;
            $('#sliders').append('<li><label for="' + id + '">' + param + '</label><div id="' + id + '"></div><div class="value" id="' + id + '-val">0</div></li>');
            $('#' + id).slider({
                value: initialVal,
                range: "min",
                animate: true,
                step: 10,
                slide: function(event, ui) {
                    currentWeights[$(this).attr('id')] = ui.value;
                    $('#' + id + '-val').text(ui.value);
                    ga('send', 'event', 'slider-adjust', param, '', ui.value);
                    submit();
                }
            });
        });
        setupInitialMatches();
        if (initialSubmit) submit();
    });
});
/*
 * Sets up the initial matchups based on seeding for a given region.
 * Any teams with identical seed numbers and regions are treated as a "First Four" match.
 */

function setupInitialMatches() {
    for (var matchupID in firstFours) {
        matchup = firstFours[matchupID];
        $('#first-four').append('<li id="matchup' + matchupID + '"><div class="region">' + regions[matchup[0].Region] + ' (' + matchup[0].Seed +
        '):</div><div class="team1">' + matchup[0].Name + '</div> vs <div class="team2">' + matchup[1].Name + '</div></li>');
    }
    for (var regionID = 0; regionID < regions.length; regionID++) {
        var region = regions[regionID];
        var list = $('<ul/>');
        regionTeams = bracketTeamsByRegionAndSeed[regionID];
        for (var seed = 1; seed < 9; seed++) {
            var high = regionTeams[seed];
            var lowString = '';
            if ((17 - seed) in regionTeams) {
                var lowTeam = regionTeams[17 - seed];
                lowString = '(' + lowTeam.stats.Seed + ') ' + lowTeam.Name;
                $('#' + region.toLowerCase() + 'seed' + lowTeam.stats.Seed).text('(' + lowTeam.stats.Seed + ') ' + lowTeam.Name);
            } else {
                $('#' + region.toLowerCase() + 'seed' + (17 - seed)).html('(' + (17 - seed) + ') <i>First 4 winner</i>');
            }
            $('#' + region.toLowerCase() + 'seed' + high.stats.Seed).text('(' + high.stats.Seed + ') ' + high.Name);
        }
    }
}

/*
 * Determine the winner of a matchup based on weight.
 * Return the team object for the winning team.
 * Tie breaker is the higher overall rank
 */
function getWinner(team1, team2) {
    team1Total = 0;
    team2Total = 0;
    for (var weightName in currentWeights) {
        weight = currentWeights[weightName];
        if (weightName == 'Seed') {
            // Higher seeds are worse, so invert the value range
            team1Total += (17 - team1.stats[weightName]) * weight;
            team2Total += (17 - team2.stats[weightName]) * weight;
        } else {
            team1Total += team1.stats[weightName] * weight;
            team2Total += team2.stats[weightName] * weight;
        }
    }
    if (team1Total == team2Total) {
        return parseInt(team1.Rank) < parseInt(team2.Rank) ? team1 : team2;
    }
    return team1Total > team2Total ? team1 : team2;
}

/*
 * Determines which team actually won in the matchup.
 * If the matchup hasnt occured yet, return null.
 */
function setTrueWinner(team1, team2, round, winner, team1Div, team2Div) {
    if(team1['Games Won'] == team2['Games Won'] && round == team1['Games Won']) {
        //return null;
        $(team1Div).removeClass('incorrect').removeClass('correct');
        $(team2Div).removeClass('incorrect').removeClass('correct');
    } else {
        if(team1['Games Won'] > team2['Games Won'] && team1 == winner && team1['Games Won'] >= round) {
            $(team1Div).removeClass('incorrect').addClass('correct');
        } else if (team1['Games Won'] < team2['Games Won'] && team2 == winner && team2['Games Won'] >= round) {
            $(team2Div).removeClass('incorrect').addClass('correct');        
        }
        
        if(team1['Games Won'] < round && team1 == winner) {
            $(team1Div).addClass('incorrect').removeClass('correct');
        }
        if(team2['Games Won'] < round && team2 == winner) {
            $(team2Div).addClass('incorrect').removeClass('correct');
        }
    }
    //return (team1['Games Won'] > team2['Games Won']) ? team1 : team2;
}

/* 
 * Utility function for converting game numbers in gameWinners object to rounds.
 */
function getRound(gameNumber) {
    if(gameNumber >= 1 && gameNumber <= 8) return 1;
    if(gameNumber >= 9 && gameNumber <= 12) return 2;
    if(gameNumber >= 13 && gameNumber <= 14) return 3;
    if(gameNumber == 15) return 4;
    return null;
}
/*
 * Loop through the list of weights, calculating the relative values.
 * Then loop through each matchup, determining the winner and updating the bracket
 */

function submit() {
    var totalWeight = 0;
    var queryString = "";
    $.each(headers, function(i, param) {
        var id = attrToID(param);
        if (nonStatHeaders.indexOf(id) > -1) return true;
        totalWeight += currentWeights[id];
        if (currentWeights[id] !== 0) {
            if (queryString !== "") queryString += "&";
            queryString = queryString + id + "=" + currentWeights[id];
        }
    });
    // Create the URL
    var path = document.URL.split("?")[0] + "?" + "year=" + year + "&" + queryString;
    $('#share').val(path);
    relativeWeights = {};
    $.each(currentWeights, function(param) {
        var id = attrToID(param);
        relativeWeights[param] = (currentWeights[param] / totalWeight).toFixed(3);
    });
    // Set the 'random weight' value
    for (var regionID in bracketTeamsByRegionAndSeed) {
        var region = bracketTeamsByRegionAndSeed[regionID];
        for (var seed in region) {
            region[seed].stats.R = Math.random() * 100;
        }
    }
    for (var matchupID in firstFours) {
        var winner = getWinner(firstFours[matchupID][0], firstFours[matchupID][1]);
        var team1Div = '#matchup' + matchupID + ' > .team1';
        var team2Div = '#matchup' + matchupID + ' > .team2';
        setTrueWinner(firstFours[matchupID][0], firstFours[matchupID][1], 0, winner, team1Div, team2Div);
        
        if (winner == firstFours[matchupID][0]) {
            $(team1Div).removeClass('loser').addClass('winner');
            $(team2Div).removeClass('winner').addClass('loser');
        } else {
            $(team1Div).removeClass('winner').addClass('loser');
            $(team2Div).removeClass('loser').addClass('winner');
        }

        bracketTeamsByRegionAndSeed[winner.Region][winner.stats.Seed] = winner;
        $('#' + regions[winner.Region].toLowerCase() + 'seed' + winner.stats.Seed).text('(' + winner.stats.Seed + ') ' + winner.Name);
        $('#FirstFour' + matchupID + 'Result').text("Winner: " + winner.Name);
    }
    var gameWinnerRegions = [{}, {}, {}, {}];
    for (regionID in regions) {
        var currentRegion = bracketTeamsByRegionAndSeed[regionID];
        var gameWinners = gameWinnerRegions[regionID];
        var bracketData = {
            teams: [],
            scores: []
        };
        var region = regions[regionID].toLowerCase();
        // First round of 64
        for (var seed = 1; seed < 9; seed++) {
            var high = currentRegion[seed];
            var low = currentRegion[17 - seed];
            var highDiv = '#' + region + 'seed' + high.stats.Seed;
            var lowDiv = '#' + region + 'seed' + low.stats.Seed;
            
            bracketData.teams.push(['(' + high.stats.Seed + ') ' + high.Name, '(' + low.stats.Seed + ') ' + low.Name]);
            var winner = getWinner(high, low);
            setTrueWinner(high, low, 1, winner, highDiv, lowDiv);
            gameWinners['game' + String(seed)] = winner;
            $('#' + region + 'seed' + winner.stats.Seed).removeClass('loser').addClass('winner');
            if (high == winner) {
                $(lowDiv).removeClass('winner').addClass('loser');
            } else {
                $(highDiv).removeClass('winner').addClass('loser');
            }
            
            $('#' + region + 'game' + seed).text('(' + winner.stats.Seed + ') ' + winner.Name);
        }
        // Round of 32 through the Elite 8
        var gameDiff = 8;
        for (var game = 9; game < 16; game++) {
            var high = gameWinners['game' + String(game - gameDiff)];
            var low = gameWinners['game' + String(game + 1 - gameDiff)];
            var highDiv = '#' + region + 'game' + String(game - gameDiff);
            var lowDiv = '#' + region + 'game' + String(game + 1- gameDiff);
            var winner = getWinner(high, low);
            setTrueWinner(high, low, getRound(game), winner, highDiv, lowDiv);
            gameWinners['game' + String(game)] = winner;
            $('#' + region + 'game' + game).text('(' + winner.stats.Seed + ') ' + winner.Name);
            if (high == winner) {
                $(highDiv).removeClass('loser').addClass('winner');
                $(lowDiv).removeClass('winner').addClass('loser');
            } else {
                $(highDiv).removeClass('winner').addClass('loser');
                $(lowDiv).removeClass('loser').addClass('winner');
            }
            gameDiff--;
        }
    }
    // Final four and championship game
    var regionID = 0;
    var sides = ["left", "right"];
    var championship = {};
    for (var side in sides) {
        var region1 = regionID;
        var region2 = regionID + 1;
        var team1 = gameWinnerRegions[region1].game15;
        var team1Div = '#' + regions[region1].toLowerCase() + 'game15';
        var team2Div = '#' + regions[region2].toLowerCase() + 'game15'
        var team2 = gameWinnerRegions[region2].game15;
        var winner = getWinner(team1, team2);
        setTrueWinner(team1, team2, 5, winner, team1Div, team2Div);
        championship[sides[side]] = winner;
        $('#' + sides[side] + 'game').text('(' + winner.stats.Seed + ') ' + winner.Name);
        if (team1 == winner) {
            $(team1Div).removeClass('loser').addClass('winner');
            $(team2Div).removeClass('winner').addClass('loser');
        } else {
            $(team1Div).removeClass('winner').addClass('loser');
            $(team2Div).removeClass('loser').addClass('winner');
        }
        regionID += 2;
    }
    var winner = getWinner(championship.left, championship.right);
    setTrueWinner(championship.left, championship.right, 6, winner, '#leftgame', '#rightgame');
    $('#championship').text('(' + winner.stats.Seed + ') ' + winner.Name);
    if (championship.left == winner) {
        $('#leftgame').removeClass('loser').addClass('winner');
        $('#rightgame').removeClass('winner').addClass('loser');
    } else {
        $('#leftgame').removeClass('winner').addClass('loser');
        $('#rightgame').removeClass('loser').addClass('winner');
    }
}
/*
 * Converts the statistic name to the id used in js objects and html ids.
 */

function attrToID(attr) {
    // TODO: might be able to remove this check? maybe leaver just seed
    if (nonStatHeaders.indexOf(attr) > -1 || attr == 'Seed') return attr;
    return attr.replace(/[ a-z%\/]/g, "");
}