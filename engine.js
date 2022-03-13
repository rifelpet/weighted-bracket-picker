/*jslint browser: true*/
/*global $, jQuery, alert*/
var currentWeights = {};

// Used as a cache so that we aren't re-requesting CSVs over and over
var statCache = {};

var seedMatchOrder = [1, 8, 5, 4, 6, 3, 7, 2];

// array of regions, each representing hashmaps representing seed numbers
// Does not contain losers of first-four matchups.
var bracketTeamsByRegionAndSeed = [{}, {}, {}, {}];

var headers = [];
// RegionIDs in the csv are the 'regions' indeces
var regions = ['South', 'East', 'West', 'Midwest'];

// Headers that arent used in comparison for winner determination
var nonStatHeaders = ['Rank', 'Region', 'Name', 'Games Won'];

var firstFours = [];
var totalGames = 0; // This will be 63 except for the current year
var totalScore = 0; // This will be 192 except for the current year

var highestGamesPlayed = -1; // This will be 6 except for the current year

var urlParams = {};
var latestYear = '2022';
var currActivity = 'cbbm'
const defaultActivity = 'cbbm';
var currYear = latestYear;
var tournamentStarted = false;

var descriptions = {
    "Seed": "Team's position in the bracket. 1 seeds have the 'easiest' path to the final four. This stat is ranked inversely- the lowest value is ranked the highest.",
    "SS": "Strength of Schedule. A ranking of the team's opponents. A team who plays harder opponents will have a higher strength of schedule.",
    "WP": "Team's Wins / Total Games prior to the tournament. An undefeated team would have a win percentage of 100%.",
    "PG": "Average points a team scores per game.",
    "OPG": " Average points a team's opponent scores per game. This stat is ranked inversely- the lowest value is ranked the highest.",
    "FGP": "Team Field Goal Percentage.",
    "3PFGP": "Team 3-Point Field Goal Percentage.",
    "FTP": "Team's Free Throw shooting percentage.",
    "OR": "Estimate of points scored by a team per 100 possessions. Offensive Rating is different than points per game in that it eliminates the influence of a team's pace. A slow paced team will have less possessions per game and less opportunity to score, resulting in a lower points per game stat. However, if this team scores on almost every possession, they will have a high offensive rating.",
    "DR": "Estimate of points a team allowed their opponents to score per 100 possessions. This stat is ranked inversely- the lowest value is ranked the highest.",
    "ASM": "Difference between a team's offense rating and defense rating. The Scoring Margin after 100 possessions.",
    "RP": "Percentage of available rebounds a team grabs during a game.",
    "ORP": "Percentage of available offensive rebounds a team grabs during a game. Offensive rebounds are important because they keep a possession alive and allow a team to get more chances at scoring.",
    "EFGP": "Team's Total Field Goal percentage adjusted for the fact that a 3-point field goal is worth more than a 2-point field goal.",
    "TSP": "Team's combined shooting efficiency that takes into account 3 pointers, 2 point field goals, and free throws.",
    "OTSP": " Opponent's combined shooting efficiency that takes into account 3 pointers, 2 point field goals, and free throws. A measure of how good a team is at making their opponent's miss. This stat is ranked inversely- the lowest value is ranked the highest.",
    "P": "Estimate of the number of possessions a team has per 40 minute game. Ranked by fastest paced teams. If you prefer slow paced teams, do not use this slider.",
    "TP": "Estimate of turnovers a team commits per 100 offensive possessions. This stat is ranked inversely- the lowest value is ranked the highest.",
    "OTP": "Estimate of turnovers a team forces their opponents to have per 100 defensive possessions.",
    "TM": "Difference between the number of times a team loses the ball vs times their opponent loses the ball.",
    "AP": "Percentage of team's field goals that were assisted.",
    "AT": "Number of assists per turnover a team has.",
    "FTFGA": "Free Throws made per Field Goal Attempt. Shows how effective a team is at getting fouled and making their free throws. A higher free throw rate mean's a team plays more aggressively and to draw contact in the paint and get fouled.",
    "OFTFGA": "Opponent's Free Throws made per Field Goal Attempt. Shows a team's ability to avoid fouling their opponent. A low opponent's free throw rate means that a team is good at not fouling their opponent. This stat is ranked inversely- the lowest value is ranked the highest."
};

function getDefaultYear(urlValue) {
    var defYear = currYear;
    if (urlValue !== '') {
        defYear = URLParamToYear(urlValue[0]);
    } else if (Cookies.get('w') !== undefined && !isNaN(parseInt(Cookies.get('w').substring(0, 1), 36))) {
        defYear = URLParamToYear(Cookies.get('w').substring(0, 1));
    }
    return defYear;
}

function selectShare(inputTag) {
    inputTag.select();
    payload = {
        action: 'share',
        url: inputTag.value
    }
    $.get( "https://us-central1-rock-groove-168905.cloudfunctions.net/algebracket-tracking", payload);
}

function selectYearAndActivity() {
    currYear = $('select[name="year"]').val();
    currActivity = $('select[name="activity"]').val();

    var currWeightCookie = Cookies.get('w');
    if (currWeightCookie !== undefined) {
        var yearParam = YearToURLParam(currYear);
        Cookies.set('w', yearParam + currWeightCookie.substring(1, currWeightCookie.length));
    }

    var currActivityCookie = Cookies.get('a');
    if (currActivityCookie !== undefined || currActivityCookie != currActivity) {
        Cookies.set('activity', currActivity);
    }

    var cacheKey = currActivity + currYear;
    if (typeof statCache[cacheKey] === "undefined") {
        var csvPath = 'data/' + currActivity + '/' + currYear + '.csv';
        $.get(csvPath, function (data) {
            statCache[cacheKey] = data;
            parseData(cacheKey);
        }).fail(function() {
            $('#play-in-title').addClass('alert').text('The selected year\'s data is not available for this activity. Please choose a different year.');
            clear(false);
        });
    } else {
        parseData(cacheKey);
    }
}

$(function () {
    // Grab values from the url if any
    location.search.substr(1).split('&').forEach(function (item) {
        var key = item.split('=')[0];
        urlParams[key] = decodeURIComponent(item.split('=')[1]).replace(/\//g, '');
    });

    if (urlParams.hasOwnProperty('a')) {
        currActivity = urlParams.a;
    }

    currYear = getDefaultYear(urlParams.hasOwnProperty('w') ? urlParams.w : '');
    $('select[name="year"]').val(currYear);
    $('select[name="activity"]').val(currActivity);

    selectYearAndActivity();
});

function mouseUp(id) {
    submit(true)
}

function updateStat(id) {
    var newVal = $('#' + id + ' > input').val();
    currentWeights[id] = parseInt(newVal);
    $('#' + id + '-val').text(newVal);
    submit(false);
}


function parseData(cacheKey) {
    var lines = statCache[cacheKey].trim().split("\n");
    headers = lines[0].trim().split(',');
    bracketTeamsByRegionAndSeed = [{}, {}, {}, {}];
    firstFours = [];
    totalGames = 0;
    totalScore = 0;

    for (var i = 1; i < lines.length; i++) {
        var currentLine = lines[i].split(',');
        var team = {};
        team.stats = {};
        for (var j = 0; j < headers.length; j++) {
            if (nonStatHeaders.indexOf(headers[j]) > -1) {
                team[headers[j]] = currentLine[j];
            } else {
                team.stats[attrToID(headers[j])] = currentLine[j];
            }
        }
        team.Name = abbreviateName(team.Name);
        if (team.stats.Seed in bracketTeamsByRegionAndSeed[team.Region]) {
            firstFours.push([team, bracketTeamsByRegionAndSeed[team.Region][team.stats.Seed]]);
            delete bracketTeamsByRegionAndSeed[team.Region][team.stats.Seed];
        } else {
            bracketTeamsByRegionAndSeed[team.Region][team.stats.Seed] = team;
        }
        var gamesWon = parseInt(team['Games Won']);
        if (gamesWon > 0) {
            totalGames += gamesWon;
            totalScore += Math.pow(2, gamesWon) - 1;
            if(currYear === latestYear) {
                tournamentStarted = true;
            }
        } else if (gamesWon < 0) {
            tournamentStarted = true
        }
        if(gamesWon > highestGamesPlayed) {
            highestGamesPlayed = gamesWon;
        }
    }
    
    var headerCount = headers.length - nonStatHeaders.length;
    var sliderCounter = 0;
    $.each(headers, function (i, param) {
        var id = attrToID(param);
        if (nonStatHeaders.indexOf(id) > -1) return true;
        if ($('#' + id).length === 0) {
            currentWeights[id] = 0;
            var column = Math.floor(sliderCounter * 3/ headerCount);
            $('#slider-col' + String(column) + ' > ul').append('<li class="uk-form-row"><label class="slider-label uk-text-nowrap uk-form-label" for="' + id + '" title="' + descriptions[id] + '">' + param + '</label><div class="slider-wrapper"><div class="value" id="' + id + '-val">0</div><div id="' + id + '"></div></div></li>');
            $('#' + id).append('<input class="uk-form" value="0" min="0" max="10" type="range" oninput="updateStat(\'' + id + '\')" onmouseup="mouseUp(\'' + id + '\')">')
        }
        sliderCounter++;
    });
    if (urlParams.hasOwnProperty('w') && urlParams.w.length > 0) {
        URLToWeights(urlParams);
    }
    weightsToURL();
    // Now that sliders have been built and values assigned,
    // setup the event handlers
    $.each(headers, function (i, param) {
        var id = attrToID(param);
        if (nonStatHeaders.indexOf(id) > -1) return true;
        if (window.ga && ga.loaded) {
            $('#' + id).on("change", function () {
                ga('send', 'event', 'slider-adjust', param, '', this.value);
            });
        }
    });
    
    setupInitialMatches();
    submit(false);
}
/*
 * Sets up the initial matchups based on seeding for a given region.
 * Any teams with identical seed numbers and regions are treated as a "First Four" match.
 */

function setupInitialMatches() {
    if (currYear != latestYear) {
        $('#play-in-title').addClass('alert').text('The ' + latestYear + ' bracket is available. Switch the year below.');
    } else {
        $('#play-in-title').removeClass('alert').text('');
    }
    if (firstFours.length == 1) {
        $('#play-in-title').text('Play-In');
    } else if (firstFours.length != 0) {
        $('#play-in-title').text('First Four');
    }
    $('#play-in').text('');
    for (var matchupID in firstFours) {
        matchup = firstFours[matchupID];
        $('#play-in').append('<li id="matchup' + matchupID + '"><div class="region"> (' + matchup[0].stats.Seed +
        '):</div><div class="team1">' + matchup[0].Name + '</div> vs <div class="team2">' + matchup[1].Name + '</div></li>');
    }
    for (var regionID = 0; regionID < regions.length; regionID++) {
        var region = regions[regionID];
        regionTeams = bracketTeamsByRegionAndSeed[regionID];
        for (var seed = 1; seed < 9; seed++) {
            var high = regionTeams[seed];
            var lowString = '';
            if ((17 - seed) in regionTeams) {
                var lowTeam = regionTeams[17 - seed];
                lowString = lowTeam.stats.Seed + '. ' + lowTeam.Name;
                $('#' + region.toLowerCase() + 'seed' + lowTeam.stats.Seed).text(lowTeam.stats.Seed + '. ' + lowTeam.Name);
            } else {
                $('#' + region.toLowerCase() + 'seed' + (17 - seed)).html((17 - seed) + '. <i>Play-In winner</i>');
            }
            $('#' + region.toLowerCase() + 'seed' + high.stats.Seed).text(high.stats.Seed + '. ' + high.Name);
        }
    }
    if(tournamentStarted || currYear !== latestYear) {
        $('#scoring-wrapper > div > h1').css('color', '');
        $('#correct').text('0 / ' + totalGames);
        $('#score').text('0 / ' + totalScore);
    } else {
        clearScoreDisplay();
    }
}

function abbreviateName(name) {
    return name.replace('South ', 'S. ').replace('North ', 'N. ').replace('West ', 'W. ')
    .replace(/\.$/, '').replace('Southern California', 'S. California').replace('Southern', 'Sthn.').replace('Bakersfield', 'Bkfd.');
}


/*
 * Makes the score and games correct counters grey
 * and displays N/A instead of X/Y
 */
function clearScoreDisplay() {
    $('#scoring-wrapper > div > h1').css('color', 'grey');
    $('#correct').text('N/A');
    $('#score').text('N/A');
}

/*
 * Determine the winner of a matchup based on weight.
 * Return the team object for the winning team.
 * Tie breaker is the higher overall rank
 */
function runMatchup(team1, team2, round, team1Div, team2Div) {
    var team1Total = 0;
    var team2Total = 0;
    for (var weightName in currentWeights) {
        weight = currentWeights[weightName];
        if (team1.stats[weightName] === undefined) {
            console.log('warning: missing stat for ' + team1.Name + ': ' + weightName);
            continue;
        }
        if (weightName == 'Seed') {
            // Higher seeds are worse, so invert the value range
            team1Total += (16 - team1.stats[weightName]) * weight / 16;
            team2Total += (16 - team2.stats[weightName]) * weight / 16;
        } else {
            team1Total += team1.stats[weightName] * weight;
            team2Total += team2.stats[weightName] * weight;
        }
    }
    var winningPct;
    if ((team1Total == team2Total && parseInt(team1.Rank) < parseInt(team2.Rank)) || team1Total > team2Total) {
        $(team1Div).removeClass('loser').addClass('winner');
        $(team2Div).removeClass('winner').addClass('loser');
        winningPct = getWinningPct(team1Total, team2Total); 
        return [team1, winningPct, team2];
    } else {
        $(team2Div).removeClass('loser').addClass('winner');
        $(team1Div).removeClass('winner').addClass('loser');
        winningPct = getWinningPct(team2Total, team1Total);
        return [team2, winningPct, team1];
    }
}

function getWinningPct(winnerTotal, loserTotal) {
    var winningPct = Math.ceil((2 * (100 * winnerTotal / (winnerTotal + loserTotal))) - 100);
    if (isNaN(winningPct)) {
        winningPct = 0;
    }
    return winningPct;
}

/* 
 * Utility function for converting game numbers in gameWinners object to rounds.
 */
function getRound(gameNumber) {
    if (gameNumber >= 1 && gameNumber <= 8) return 1;
    if (gameNumber >= 9 && gameNumber <= 12) return 2;
    if (gameNumber >= 13 && gameNumber <= 14) return 3;
    if (gameNumber == 15) return 4;
    return null;
}
/*
 * Loop through the list of weights, calculating the relative values.
 * Then loop through each matchup, determining the winner and updating the bracket
 */

function submit(logEvent) {
    var totalWeight = 0;
    $.each(headers, function (i, param) {
        var id = attrToID(param);
        if (nonStatHeaders.indexOf(id) > -1) return true;

        totalWeight += currentWeights[id];
    });
    if (totalWeight === 0) {
        clear(true);
        weightsToURL();
        return;
    }

    relativeWeights = {};
    $.each(currentWeights, function (param) {
        var id = attrToID(param);
        relativeWeights[param] = (currentWeights[param] / totalWeight).toFixed(3);
    });

    for (var matchupID in firstFours) {
        var team1Div = '#matchup' + matchupID + ' > .team1';
        var team2Div = '#matchup' + matchupID + ' > .team2';
        var winnerData = runMatchup(firstFours[matchupID][0], firstFours[matchupID][1], -1, team1Div, team2Div);
        var winner = winnerData[0];
        var winnerPct = winnerData[1];
        bracketTeamsByRegionAndSeed[winner.Region][winner.stats.Seed] = winner;
        $('#' + regions[winner.Region].toLowerCase() + 'seed' + winner.stats.Seed).text(winner.stats.Seed + '. ' + winner.Name);
    }
    
    var correctCount = 0;
    var correctScore = 0;
    var gameWinnerRegions = [{}, {}, {}, {}];
    for (var regionID in regions) {
    //{var regionID = 0; 
        var currentRegion = bracketTeamsByRegionAndSeed[regionID];
        var gameWinners = gameWinnerRegions[regionID];
        var bracketData = {
            teams: [],
            scores: []
        };
        var region = regions[regionID].toLowerCase();
        // First round of 64
        for (var index in seedMatchOrder) {
            var seed = seedMatchOrder[index];
            var high = currentRegion[seed];
            var low = currentRegion[17 - seed];
            // game numbers #ids are 1-indexed rather than 0-indexed
            var gameNum = parseInt(index) + 1;
            var highDiv = '#' + region + 'seed' + high.stats.Seed;
            var lowDiv = '#' + region + 'seed' + low.stats.Seed;
            
            bracketData.teams.push([high.stats.Seed + '. ' + high.Name, low.stats.Seed + '. ' + low.Name]);
            var winnerData = runMatchup(high, low, 0, highDiv, lowDiv);
            var winner = winnerData[0];
            var winnerPct = winnerData[1];
            var loser = winnerData[2];
            gameWinners['game' + String(gameNum)] = winner;

            $('#' + region + 'seed' + winner.stats.Seed).removeClass('loser').addClass('winner');

            $('#' + region + 'game' + gameNum).text(winner.stats.Seed + '. ' + winner.Name + ' ' + winnerPct + '%');
            if (totalGames > 0 && (winner['Games Won'] > 0 || loser['Games Won'] > 0)) {
                if (winner['Games Won'] > 0) {
                    correctCount++;
                    correctScore += 1;
                    $('#' + region + 'game' + gameNum).removeClass('incorrect').addClass('correct');
                } else {
                    $('#' + region + 'game' + gameNum).removeClass('correct').addClass('incorrect');
                }
            } else {
                $('#' + region + 'game' + gameNum).removeClass('incorrect').removeClass('correct');
            }
        }
        // Round of 32 through the Elite 8
        var gameDiff = 8;
        for (var game = 9; game < 16; game++) {
            var high = gameWinners['game' + String(game - gameDiff)];
            var low = gameWinners['game' + String(game + 1 - gameDiff)];
            var highDiv = '#' + region + 'game' + String(game - gameDiff);
            var lowDiv = '#' + region + 'game' + String(game + 1- gameDiff);
            var winnerData = runMatchup(high, low, getRound(game), highDiv, lowDiv);
            var winner = winnerData[0];
            var winnerPct = winnerData[1];   
            var loser = winnerData[2];         
            gameWinners['game' + String(game)] = winner;
            $('#' + region + 'game' + game).text(winner.stats.Seed + '. ' + winner.Name + ' ' + winnerPct + '%');

            var round = getRound(game);
            if (totalGames > 0 && (winner['Games Won'] >= round || loser['Games Won'] >= round)) {
                if (winner['Games Won'] >= round) {
                    correctCount++;
                    if (game <= 12) correctScore += 2;
                    else if (game <= 14) correctScore += 4;
                    else correctScore += 8;
                    $('#' + region + 'game' + game).removeClass('incorrect').addClass('correct');
                } else {
                    $('#' + region + 'game' + game).removeClass('correct').addClass('incorrect');
                }
            } else if (totalGames > 1 && highestGamesPlayed >= winner['Games Won']) {
                $('#' + region + 'game' + game).removeClass('correct').addClass('incorrect');
            } else {
                $('#' + region + 'game' + game).removeClass('correct').removeClass('incorrect');
            }
            gameDiff--;
        }
    }
    // Final four and championship game
    var regionID = 0;
    var sides = ['left', 'right'];
    var championship = {};
    for (var side in sides) {
        var region1 = regionID;
        var region2 = regionID + 1;
        var team1 = gameWinnerRegions[region1].game15;
        var team1Div = '#' + regions[region1].toLowerCase() + 'game15';
        var team2Div = '#' + regions[region2].toLowerCase() + 'game15';
        var team2 = gameWinnerRegions[region2].game15;
        var winnerData = runMatchup(team1, team2, 5, team1Div, team2Div);
        var winner = winnerData[0];
        var winnerPct = winnerData[1];  
        var loser = winnerData[2];      
        championship[sides[side]] = winner;
        
        $('#' + sides[side] + 'game').text(winner.stats.Seed + '. ' + winner.Name + ' ' + winnerPct + '%');
        if (totalGames > 0 &&  (winner['Games Won'] >= 5 || loser['Games Won'] >= 5)) {
            if (winner['Games Won'] >= 5) {
                correctCount++;
                correctScore += 16;
                $('#' + sides[side] + 'game').removeClass('incorrect').addClass('correct');
            } else {
                $('#' + sides[side] + 'game').removeClass('correct').addClass('incorrect');
            }
        } else if (totalGames > 0 && highestGamesPlayed >= 5) {
            $('#' + sides[side] + 'game').removeClass('correct').addClass('incorrect');
        } else {
            $('#' + sides[side] + 'game').removeClass('correct').removeClass('incorrect');
        }
        regionID += 2;
    }
    var winnerData = runMatchup(championship.left, championship.right, 6, '#leftgame', '#rightgame');
    var winner = winnerData[0];
    var winnerPct = winnerData[1];
    var loser = winnerData[2];
    if (totalGames > 0 && (winner['Games Won'] == 6 || loser['Games Won'] == 6)) {
        if (winner['Games Won'] == 6) {
            correctCount++;
            correctScore += 32;
            $('#championship').removeClass('incorrect').addClass('correct');
        } else {
            $('#championship').removeClass('correct').addClass('incorrect');
        }
    } else if (totalGames > 0 && highestGamesPlayed == 6) {
        $('#championship').removeClass('correct').addClass('incorrect');
    } else {
        $('#championship').removeClass('correct').removeClass('incorrect');
    }
    $('#championship').text(winner.stats.Seed + '. ' + winner.Name + ' ' + winnerPct + '%');
    if(tournamentStarted || currYear !== latestYear) {
        $('#scoring-wrapper > div > h1').css('color', '');
        $('#correct').text(String(correctCount) + ' / ' + String(totalGames));
        $('#score').text(String(correctScore) + ' / ' + String(totalScore));
    } else {
        clearScoreDisplay();
    }
    weightsToURL();
    if(logEvent){
        payload = {
            action: 'render',
            weights: saveCookie(),
            activity: currActivity,
            correctScore: correctScore,
            year: currYear
        }
        $.get( "https://us-central1-rock-groove-168905.cloudfunctions.net/algebracket-tracking", payload);
    }
}

function clear(setup) {
    // Easier to just wipe everything and rerun the setup
    for(var regionID in regions) {
        var regionName = regions[regionID].toLowerCase();
        $('[id^=' + regionName + 'game]').removeClass('winner').removeClass('loser').removeClass('correct').removeClass('incorrect').text('');
        $('[id^=' + regionName + 'seed]').removeClass('winner').removeClass('loser').removeClass('correct').removeClass('incorrect');
    }
    $('#play-in').text('');
    $('#leftgame').removeClass('winner').removeClass('loser').removeClass('correct').removeClass('incorrect').text('');
    $('#rightgame').removeClass('winner').removeClass('loser').removeClass('correct').removeClass('incorrect').text('');
    $('#championship').removeClass('winner').removeClass('loser').removeClass('correct').removeClass('incorrect').text('');

    if (setup) {
        setupInitialMatches();
    } else {
        for (var regionID = 0; regionID < regions.length; regionID++) {
            for (var seed = 1; seed < 17; seed++) {
                var region = regions[regionID].toLowerCase();
                $('#' + region + 'seed' + seed).text('');
            }
        }
    }
}

/*
 * Resets all sliders to zero, clearing the bracket.
 */
function resetSliders() {
    $.each(headers, function (i, param) {
        if (param in nonStatHeaders) return true;

        $('#' + attrToID(param) + ' > input').val(0);
        $('#' + attrToID(param) + '-val').text('0');
    });
    $.each(currentWeights, function (i, param) {
       currentWeights[i] = 0;
    });
    Cookies.remove('w');
    clear(true);
}

/*
 * Converts the statistic name to the id used in js objects and html ids.
 */

function attrToID(attr) {
    // TODO: might be able to remove this check? maybe leave just seed
    if (nonStatHeaders.indexOf(attr) > -1 || attr == 'Seed') return attr;
    short = attr.replace(/%/, 'P').replace(/[ a-z%\.\/]/g, '');
    return short
}

function weightsToURL() {
    // Create the URL
    var weightValue = saveCookie();
    if(window.ga && ga.loaded) {
        ga('send', 'event', 'bracket', 'build', '', weightValue);
    }
    var path = document.URL.split('?')[0] + '?w=' + weightValue;
    if (path.substring(0, 4) != "http") {
        path = 'https://' + path;
    }
    if (currActivity != defaultActivity) {
        path += '&a=' + currActivity;
    } 
    
    $('#share').val(path);
    $('#twitter-share').html('<a class="twitter-share-button social-link" data-text="Check out my #Algebracket!" data-url="' + path + '">Tweet</a>')
    if (twttr !== undefined && twttr.widgets !== undefined) {
        twttr.widgets.load();
    }
    //$('.fb-share-button').attr('data-href', path);
    //window.history.pushState({w:weightValue},"AlgeBracket", path);
    return path;
}

function saveCookie() {
    var sortedWeights = [];
    var urlValue = YearToURLParam(currYear);
    for (var k in currentWeights) {
        sortedWeights.push(k);
    }
    sortedWeights.sort();
    for(var weightName in sortedWeights) {
        var weightVal = String(currentWeights[sortedWeights[weightName]]);
        if (weightVal === '10') {
            weightVal = 'A';
        }
        urlValue += weightVal;
    }
    Cookies.set('w', urlValue);
    Cookies.set('activity', currActivity);
    return urlValue
}

function URLToWeights(urlParams) {
    var sortedWeights = [];
    for (var k in currentWeights) {
        sortedWeights.push(k);
    }
    sortedWeights.sort();
    if (urlParams.w.length == 0 && Cookies.get('w') !== undefined) {
        urlParams.w = Cookies.get('w');
    }
    if ((!urlParams.hasOwnProperty('a') || urlParams.a.length == 0) && Cookies.get('activity') !== undefined) {
        currActivity = Cookies.get('activity');
    }
    year = URLParamToYear(urlParams.w[0]);
    for(var i=1; i < urlParams.w.length; i++) {
        var weightVal = urlParams.w[i];
        if (weightVal === 'A') {
            weightVal = 10;
        } else {
            weightVal = parseInt(weightVal);
        }
        weightName = sortedWeights[i - 1];
        $('#' + weightName + ' > input').val(weightVal);
        currentWeights[weightName] = weightVal;
        $('#' + weightName + '-val').text(weightVal);
    }
}

function URLParamToYear(paramChar) {
    return (2010 + parseInt(paramChar, 36)).toString();
}

function YearToURLParam(year) {
    return (parseInt(year) - 2010).toString(36).toUpperCase();
}