'use strict';

const currentWeights = {};

// Used as a cache so that we aren't re-requesting CSVs over and over
const statCache = {};

const seedMatchOrder = [1, 8, 5, 4, 6, 3, 7, 2];

// array of regions, each representing hashmaps representing seed numbers
// Does not contain losers of first-four matchups.
let bracketTeamsByRegionAndSeed = [{}, {}, {}, {}];

let headers = [];
// RegionIDs in the csv are the 'regions' indeces
const regions = ['South', 'East', 'West', 'Midwest'];

// Headers that arent used in comparison for winner determination
const nonStatHeaders = ['Rank', 'Region', 'Name', 'Games Won'];

let firstFours = [];
let totalGames = 0; // This will be 63 except for the current year
let totalScore = 0; // This will be 192 except for the current year

let highestGamesPlayed = -1; // This will be 6 except for the current year

let urlParams = {};
let latestYear;
let currActivity;
const defaultActivity = 'cbbm';
let currYear;
let tournamentStarted = false;
let initialLoad = true;

const descriptions = {
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
    let defYear = currYear;
    if (urlValue !== '') {
        defYear = URLParamToYear(urlValue[0]);
    } else if (Cookies.get('w') !== undefined && !isNaN(parseInt(Cookies.get('w').substring(0, 1), 36))) {
        defYear = URLParamToYear(Cookies.get('w').substring(0, 1));
    }
    return defYear;
}

function selectShare(inputTag) {
    inputTag.select();
    const payload = {
        action: 'share',
        url: inputTag.value
    };
    const params = new URLSearchParams(payload);
    fetch("https://alebracket-tracking-237201124851.us-central1.run.app?" + params);
}

function selectYearAndActivity() {
    currYear = document.querySelector('select[name="year"]').value;
    currActivity = document.querySelector('select[name="activity"]').value;

    const currWeightCookie = Cookies.get('w');
    if (currWeightCookie !== undefined) {
        const yearParam = YearToURLParam(currYear);
        const newVal = yearParam + currWeightCookie.substring(1, currWeightCookie.length);
        Cookies.set('w', newVal);
    }

    const currActivityCookie = Cookies.get('a');
    if (currActivityCookie !== undefined && currActivityCookie !== currActivity) {
        Cookies.set('activity', currActivity);
    }

    const cacheKey = currActivity + currYear;
    if (typeof statCache[cacheKey] === "undefined") {
        const csvPath = 'data/' + currActivity + '/' + currYear + '.csv';
        clear(false);
        fetch(csvPath)
            .then(function (response) {
                if (!response.ok) {
                    throw new Error('CSV not found');
                }
                return response.text();
            })
            .then(function (data) {
                statCache[cacheKey] = data;
            })
            .then(function () {
                parseData(cacheKey);
            })
            .catch(function (err) {
                console.error('Failed to load bracket data:', err);
                document.getElementById('play-in-title').classList.add('alert');
                document.getElementById('play-in-title').textContent = 'The selected year\'s data is not available for this activity. Please choose a different year.';
                clear(false);
            });
    } else {
        parseData(cacheKey);
    }
}

document.addEventListener('DOMContentLoaded', function () {
    // Derive latestYear from the first option in the year dropdown
    latestYear = document.querySelector('#year option:first-child').textContent.trim();
    currYear = latestYear;
    currActivity = defaultActivity;

    // Grab values from the url if any
    location.search.substr(1).split('&').forEach(function (item) {
        const key = item.split('=')[0];
        urlParams[key] = decodeURIComponent(item.split('=')[1]).replace(/\//g, '');
    });

    if (urlParams.hasOwnProperty('a')) {
        currActivity = urlParams.a;
    }

    currYear = getDefaultYear(urlParams.hasOwnProperty('w') ? urlParams.w : '');
    document.querySelector('select[name="year"]').value = currYear;
    document.querySelector('select[name="activity"]').value = currActivity;

    selectYearAndActivity();

    // Mobile menu toggle
    const pullBtn = document.getElementById('pull');
    if (pullBtn) {
        pullBtn.addEventListener('click', function (e) {
            e.preventDefault();
            const menu = this.parentNode.querySelector('ul');
            if (menu) {
                menu.classList.toggle('open');
            }
        });
    }

    // Mini bracket: show only when sliders visible AND main bracket off-screen
    let slidersVisible = false;
    let bracketVisible = true;
    let miniVisibilityTimer = null;
    let miniHeightMeasured = false;
    let teamsObserver = null;
    const miniBracketEl = document.getElementById('mini-final-four');

    function createTeamsObserver(rootMarginTopPx) {
        if (teamsObserver) { teamsObserver.disconnect(); }
        teamsObserver = new IntersectionObserver(function(entries) {
            bracketVisible = entries[0].isIntersecting;
            updateMiniVisibility();
        }, { threshold: 0, rootMargin: rootMarginTopPx + 'px 0px 0px 0px' });
        teamsObserver.observe(teamsEl);
    }

    function updateMiniVisibility() {
        clearTimeout(miniVisibilityTimer);
        miniVisibilityTimer = setTimeout(function() {
            document.body.classList.toggle('sliders-visible', slidersVisible);
            document.body.classList.toggle('bracket-visible', bracketVisible);
            if (slidersVisible && !bracketVisible) {
                requestAnimationFrame(updateMiniConnector);
                // On first show, measure the mini bracket's rendered height and tighten
                // the threshold so the mini bracket only appears when the visible portion
                // of the main bracket is smaller than the mini bracket itself.
                if (!miniHeightMeasured && miniBracketEl) {
                    var h = miniBracketEl.offsetHeight;
                    if (h > 0) {
                        miniHeightMeasured = true;
                        createTeamsObserver(-h);
                    }
                }
            }
        }, 150);
    }

    const slidersEl = document.getElementById('sliders');
    const teamsEl = document.getElementById('teams');
    if (slidersEl && teamsEl && window.IntersectionObserver) {
        new IntersectionObserver(function(entries) {
            slidersVisible = entries[0].isIntersecting;
            updateMiniVisibility();
        }, { threshold: 0 }).observe(slidersEl);
        createTeamsObserver(0);
    } else {
        document.body.classList.add('sliders-visible');
        document.body.classList.remove('bracket-visible');
    }
});

function updateMiniConnector() {
    const svg = document.getElementById('mini-connector-svg');
    if (!svg) return;
    const svgRect = svg.getBoundingClientRect();
    const W = svgRect.width;
    const H = svgRect.height;
    if (H === 0 || W === 0) return;
    const l1 = document.getElementById('mini-ff-left-1').getBoundingClientRect();
    const l2 = document.getElementById('mini-ff-left-2').getBoundingClientRect();
    const r1 = document.getElementById('mini-ff-right-1').getBoundingClientRect();
    const r2 = document.getElementById('mini-ff-right-2').getBoundingClientRect();
    const svgTop = svgRect.top;
    // Y of the gap between each pair of teams, relative to SVG top
    const y1 = (l1.bottom + l2.top) / 2 - svgTop;
    const y2 = (r1.bottom + r2.top) / 2 - svgTop;
    // Tree bracket: "[" on the left (two horizontals from FF games meeting a centered
    // vertical bar), then a single horizontal from the midpoint of that bar to the
    // championship column on the right.
    const xMid = (W / 2).toFixed(1);
    const yMid = ((y1 + y2) / 2).toFixed(1);
    const d = 'M 0 ' + y1.toFixed(1) + ' H ' + xMid +
              ' V ' + y2.toFixed(1) + ' H 0' +
              ' M ' + xMid + ' ' + yMid + ' H ' + W.toFixed(1);
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    svg.innerHTML = '<path d="' + d + '" fill="none" stroke="#7ab8d4" stroke-width="2" stroke-linejoin="round"/>';
}

// ─── Mobile bracket: region-by-region view ───

// Bracket structure: maps game/seed IDs to nested layout
// Upper half: seeds 1/16,8/9 → game1,game2 → game9 → game3,game4(5/12,4/13) → game10 → game13
// Lower half: seeds 6/11,3/14 → game5,game6 → game11 → game7,game8(7/10,2/15) → game12 → game14
var mobileBracketBuilt = false;

function buildMobileBracket() {
    var container = document.getElementById('mobile-bracket');
    if (!container) return;
    container.innerHTML = '';

    var regionDirs = { south: 'ltr', east: 'ltr', west: 'rtol', midwest: 'rtol' };
    var regionLabels = { south: 'South Region', east: 'East Region', west: 'West Region', midwest: 'Midwest Region' };

    regions.forEach(function(regionName, idx) {
        var rkey = regionName.toLowerCase();
        var dir = regionDirs[rkey];
        var panel = document.createElement('div');
        panel.id = 'panel-' + rkey;
        panel.className = 'region-panel' + (idx === 0 ? ' visible' : '');

        var label = document.createElement('div');
        label.className = 'region-label';
        label.textContent = regionLabels[rkey];
        panel.appendChild(label);

        // Round headers
        var headers = document.createElement('div');
        headers.className = 'round-headers';
        if (dir === 'ltr') {
            headers.innerHTML = '<span class="rh-r64">R64</span><span class="rh-r32">R32</span><span class="rh-s16">S16</span><span class="rh-e8">E8</span>';
        } else {
            headers.innerHTML = '<span class="rh-e8">E8</span><span class="rh-s16">S16</span><span class="rh-r32">R32</span><span class="rh-r64">R64</span>';
        }
        panel.appendChild(headers);

        // Build bracket content
        var wrap = document.createElement('div');
        if (dir === 'rtol') {
            wrap.className = 'region-wrap rtol';
        }
        var upperHalf = buildR4Wrap(rkey, dir, 'upper',
            'game13',
            { game: 'game9',  top: { game: 'game1', seeds: ['seed1','seed16'] }, bottom: { game: 'game2', seeds: ['seed8','seed9'] } },
            { game: 'game10', top: { game: 'game3', seeds: ['seed5','seed12'] }, bottom: { game: 'game4', seeds: ['seed4','seed13'] } }
        );
        var lowerHalf = buildR4Wrap(rkey, dir, 'lower',
            'game14',
            { game: 'game11', top: { game: 'game5', seeds: ['seed6','seed11'] }, bottom: { game: 'game6', seeds: ['seed3','seed14'] } },
            { game: 'game12', top: { game: 'game7', seeds: ['seed7','seed10'] }, bottom: { game: 'game8', seeds: ['seed2','seed15'] } }
        );
        if (dir === 'rtol') {
            wrap.appendChild(upperHalf);
            wrap.appendChild(lowerHalf);
            panel.appendChild(wrap);
        } else {
            panel.appendChild(upperHalf);
            panel.appendChild(lowerHalf);
        }
        container.appendChild(panel);
    });

    mobileBracketBuilt = true;
    initRegionNav();
}

function buildR4Wrap(region, dir, half, e8Game, s16Top, s16Bottom) {
    var isLtr = dir === 'ltr';
    var r4wrap = document.createElement('div');
    r4wrap.className = 'mb-r4-wrap mb-cf ' + (half === 'upper' ? 'mb-upper-half' : 'mb-lower-half');

    // E8 winner
    var r4 = document.createElement('div');
    r4.className = 'mb-r4 ' + (isLtr ? 'mb-fr' : 'mb-fl');
    r4.setAttribute('data-src', region + e8Game);
    r4wrap.appendChild(r4);

    // Two S16 wraps
    var s16t = buildR3Wrap(region, dir, s16Top, 2);
    var s16b = buildR3Wrap(region, dir, s16Bottom, 3);
    r4wrap.appendChild(s16t);
    r4wrap.appendChild(s16b);

    return r4wrap;
}

function buildR3Wrap(region, dir, s16Data, childIdx) {
    var isLtr = dir === 'ltr';
    var r3wrap = document.createElement('div');
    r3wrap.className = 'mb-r3-wrap ' + (isLtr ? 'mb-fl' : 'mb-fr') + ' mb-cf';

    // S16 winner
    var r3 = document.createElement('div');
    r3.className = 'mb-r3 ' + (isLtr ? 'mb-fr' : 'mb-fl');
    r3.setAttribute('data-src', region + s16Data.game);
    r3wrap.appendChild(r3);

    // Two R32 wraps
    var r32t = buildR2Wrap(region, dir, s16Data.top, 2);
    var r32b = buildR2Wrap(region, dir, s16Data.bottom, 3);
    r3wrap.appendChild(r32t);
    r3wrap.appendChild(r32b);

    return r3wrap;
}

function buildR2Wrap(region, dir, r32Data, childIdx) {
    var isLtr = dir === 'ltr';
    var r2wrap = document.createElement('div');
    r2wrap.className = 'mb-r2-wrap ' + (isLtr ? 'mb-fl' : 'mb-fr') + ' mb-cf';

    // R32 winner
    var r2 = document.createElement('div');
    r2.className = 'mb-r2 ' + (isLtr ? 'mb-fr' : 'mb-fl');
    r2.setAttribute('data-src', region + r32Data.game);
    r2wrap.appendChild(r2);

    // Two R64 seeds — also store game ref for pct lookup
    var r1a = document.createElement('div');
    r1a.className = 'mb-r1 ' + (isLtr ? 'mb-fl' : 'mb-fr');
    r1a.setAttribute('data-src', region + r32Data.seeds[0]);
    r1a.setAttribute('data-game', region + r32Data.game);
    r2wrap.appendChild(r1a);

    var r1b = document.createElement('div');
    r1b.className = 'mb-r1 ' + (isLtr ? 'mb-fl' : 'mb-fr');
    r1b.setAttribute('data-src', region + r32Data.seeds[1]);
    r1b.setAttribute('data-game', region + r32Data.game);
    r2wrap.appendChild(r1b);

    return r2wrap;
}

function syncMobileBracket() {
    if (!mobileBracketBuilt) buildMobileBracket();
    var container = document.getElementById('mobile-bracket');
    if (!container) return;

    // Sync all elements with data-src attributes
    var els = container.querySelectorAll('[data-src]');
    var classes = ['winner', 'loser', 'correct', 'incorrect'];
    for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var srcId = el.getAttribute('data-src');
        var srcEl = document.getElementById(srcId);
        if (!srcEl) continue;

        var isSeed = srcId.indexOf('seed') !== -1;

        if (isSeed) {
            // R64 seed: show "Seed. Name" + pct from game element
            var seedText = srcEl.textContent;
            el.innerHTML = '';
            el.appendChild(document.createTextNode(seedText + ' '));
            // Get pct from the associated game element
            var gameId = el.getAttribute('data-game');
            if (gameId) {
                var gameEl = document.getElementById(gameId);
                if (gameEl && gameEl.textContent) {
                    var gamePctMatch = gameEl.textContent.match(/(\d+)%$/);
                    if (gamePctMatch) {
                        var pctVal = parseInt(gamePctMatch[1], 10);
                        var pct = document.createElement('span');
                        pct.className = 'mb-pct';
                        // Winner gets the game pct, loser gets the inverse
                        pct.textContent = srcEl.classList.contains('winner') ? pctVal + '%' : (100 - pctVal) + '%';
                        el.appendChild(pct);
                    }
                }
            }
        } else {
            // Game element (R32+): split into tname + pct spans
            var text = srcEl.textContent;
            var pctMatch = text.match(/(\d+%)$/);
            el.innerHTML = '';
            var tname = document.createElement('span');
            tname.className = 'mb-tname';
            tname.textContent = pctMatch ? text.replace(/\s*\d+%$/, '') : text;
            el.appendChild(tname);
            if (pctMatch) {
                var pct = document.createElement('span');
                pct.className = 'mb-pct';
                pct.textContent = pctMatch[1];
                el.appendChild(pct);
            }
        }

        // Sync classes
        for (var j = 0; j < classes.length; j++) {
            el.classList.toggle(classes[j], srcEl.classList.contains(classes[j]));
        }
    }
}

function initRegionNav() {
    var navBtns = document.querySelectorAll('#region-nav .nav-btn');
    if (!navBtns.length) return;
    navBtns.forEach(function(btn) {
        btn.addEventListener('click', function() {
            var region = this.getAttribute('data-region');
            navBtns.forEach(function(b) { b.classList.remove('active'); });
            this.classList.add('active');
            var panels = document.querySelectorAll('#mobile-bracket .region-panel');
            panels.forEach(function(p) { p.classList.remove('visible'); });
            var target = document.getElementById('panel-' + region);
            if (target) target.classList.add('visible');
        });
    });
}

function mouseUp(id) {
    submit(true);
}

function updateStat(id) {
    const input = document.getElementById(id).querySelector('input');
    const newVal = input.value;
    currentWeights[id] = parseInt(newVal, 10);
    document.getElementById(id + '-val').textContent = newVal;
    submit(false);
}


function parseData(cacheKey) {
    const lines = statCache[cacheKey].trim().split("\n");
    headers = lines[0].trim().split(',');
    bracketTeamsByRegionAndSeed = [{}, {}, {}, {}];
    firstFours = [];
    totalGames = 0;
    totalScore = 0;
    tournamentStarted = false;
    highestGamesPlayed = -1;

    for (let i = 1; i < lines.length; i++) {
        const currentLine = lines[i].split(',');
        const team = {};
        team.stats = {};
        for (let j = 0; j < headers.length; j++) {
            if (nonStatHeaders.indexOf(headers[j]) > -1) {
                if (headers[j] === 'Name') {
                    team[headers[j]] = currentLine[j];
                } else {
                    team[headers[j]] = parseInt(currentLine[j], 10);
                }
            } else {
                team.stats[attrToID(headers[j])] = parseFloat(currentLine[j]);
            }
        }
        team.Name = abbreviateName(team.Name);
        if (team.stats.Seed in bracketTeamsByRegionAndSeed[team.Region]) {
            firstFours.push([team, bracketTeamsByRegionAndSeed[team.Region][team.stats.Seed]]);
            delete bracketTeamsByRegionAndSeed[team.Region][team.stats.Seed];
        } else {
            bracketTeamsByRegionAndSeed[team.Region][team.stats.Seed] = team;
        }
        const gamesWon = team['Games Won'];
        if (gamesWon > 0) {
            totalGames += gamesWon;
            totalScore += Math.pow(2, gamesWon) - 1;
            if (currYear === latestYear) {
                tournamentStarted = true;
            }
        } else if (gamesWon < 0) {
            tournamentStarted = true;
        }
        if (gamesWon > highestGamesPlayed) {
            highestGamesPlayed = gamesWon;
        }
    }

    const headerCount = headers.length - nonStatHeaders.length;
    let sliderCounter = 0;
    headers.forEach(function (param) {
        const id = attrToID(param);
        if (nonStatHeaders.indexOf(id) > -1) return;
        if (!document.getElementById(id)) {
            currentWeights[id] = 0;
            const column = Math.floor(sliderCounter * 3 / headerCount);
            createSlider(id, param, column);
        }
        sliderCounter++;
    });
    if (urlParams.hasOwnProperty('w') && urlParams.w.length > 0) {
        URLToWeights(urlParams);
    }
    weightsToURL();
    // Now that sliders have been built and values assigned,
    // setup the event handlers
    headers.forEach(function (param) {
        const id = attrToID(param);
        if (nonStatHeaders.indexOf(id) > -1) return;
        if (window.ga && ga.loaded) {
            document.getElementById(id).querySelector('input').addEventListener('change', function () {
                ga('send', 'event', 'slider-adjust', param, '', this.value);
            });
        }
    });

    setupInitialMatches();
    submit(false);
}

function createSlider(id, param, column) {
    const li = document.createElement('li');
    li.className = 'uk-margin';

    const label = document.createElement('label');
    label.className = 'slider-label uk-text-nowrap uk-form-label';
    label.htmlFor = id;
    label.title = descriptions[id] || '';
    label.textContent = param;

    const wrapper = document.createElement('div');
    wrapper.className = 'slider-wrapper';

    const valueDiv = document.createElement('div');
    valueDiv.className = 'value';
    valueDiv.id = id + '-val';
    valueDiv.textContent = '0';

    const sliderDiv = document.createElement('div');
    sliderDiv.id = id;

    const input = document.createElement('input');
    input.className = 'uk-slider';
    input.type = 'range';
    input.value = '0';
    input.min = '0';
    input.max = '10';
    input.addEventListener('input', function () { updateStat(id); });
    input.addEventListener('mouseup', function () { mouseUp(id); });
    input.addEventListener('touchend', function () { mouseUp(id); });

    sliderDiv.appendChild(input);
    wrapper.appendChild(valueDiv);
    wrapper.appendChild(sliderDiv);
    li.appendChild(label);
    li.appendChild(wrapper);

    document.querySelector('#slider-col' + column + ' > ul').appendChild(li);
}

/*
 * Sets up the initial matchups based on seeding for a given region.
 * Any teams with identical seed numbers and regions are treated as a "First Four" match.
 */

function setupInitialMatches() {
    initialLoad = false;
    const playInTitle = document.getElementById('play-in-title');
    if (currYear !== latestYear) {
        playInTitle.classList.add('alert');
        playInTitle.textContent = 'The ' + latestYear + ' bracket is available. Switch the year below.';
    } else {
        playInTitle.classList.remove('alert');
        playInTitle.textContent = '';
    }
    if (firstFours.length === 1) {
        playInTitle.textContent = 'Play-In';
    } else if (firstFours.length !== 0) {
        playInTitle.textContent = 'First Four';
    }
    const playIn = document.getElementById('play-in');
    playIn.textContent = '';
    for (let matchupID = 0; matchupID < firstFours.length; matchupID++) {
        const matchup = firstFours[matchupID];
        const li = document.createElement('li');
        li.id = 'matchup' + matchupID;

        const regionDiv = document.createElement('div');
        regionDiv.className = 'region';
        regionDiv.textContent = ' (' + matchup[0].stats.Seed + '):';

        const team1Div = document.createElement('div');
        team1Div.className = 'team1';
        team1Div.textContent = matchup[0].Name;

        const vsText = document.createTextNode(' vs ');

        const team2Div = document.createElement('div');
        team2Div.className = 'team2';
        team2Div.textContent = matchup[1].Name;

        li.appendChild(regionDiv);
        li.appendChild(team1Div);
        li.appendChild(vsText);
        li.appendChild(team2Div);
        playIn.appendChild(li);
    }
    for (let regionID = 0; regionID < regions.length; regionID++) {
        const region = regions[regionID];
        const regionTeams = bracketTeamsByRegionAndSeed[regionID];
        for (let seed = 1; seed < 9; seed++) {
            const high = regionTeams[seed];
            if ((17 - seed) in regionTeams) {
                const lowTeam = regionTeams[17 - seed];
                document.getElementById(region.toLowerCase() + 'seed' + lowTeam.stats.Seed).textContent = lowTeam.stats.Seed + '. ' + lowTeam.Name;
            } else {
                document.getElementById(region.toLowerCase() + 'seed' + (17 - seed)).innerHTML = (17 - seed) + '. <i>Play-In winner</i>';
            }
            document.getElementById(region.toLowerCase() + 'seed' + high.stats.Seed).textContent = high.stats.Seed + '. ' + high.Name;
        }
    }
    const scoringH1s = document.querySelectorAll('#scoring-wrapper > div > h1');
    if (tournamentStarted || currYear !== latestYear) {
        scoringH1s.forEach(function (el) { el.style.color = ''; });
        document.getElementById('correct').textContent = '0 / ' + totalGames;
        document.getElementById('score').textContent = '0 / ' + totalScore;
        document.getElementById('upset').textContent = '0';
    } else {
        clearScoreDisplay();
    }
    syncMobileBracket();
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
    document.querySelectorAll('#scoring-wrapper > div > h1').forEach(function (el) {
        el.style.color = 'grey';
    });
    document.getElementById('correct').textContent = 'N/A';
    document.getElementById('score').textContent = 'N/A';
}

/*
 * Determine the winner of a matchup based on weight.
 * Return the team object for the winning team.
 * Tie breaker is the higher overall rank
 */
function runMatchup(team1, team2, team1El, team2El) {
    let team1Total = 0;
    let team2Total = 0;
    for (const weightName in currentWeights) {
        const weight = currentWeights[weightName];
        if (team1.stats[weightName] === undefined) {
            console.log('warning: missing stat for ' + team1.Name + ': ' + weightName);
            continue;
        }
        if (weightName === 'Seed') {
            // Higher seeds are worse, so invert the value range
            team1Total += (16 - team1.stats[weightName]) * weight / 16;
            team2Total += (16 - team2.stats[weightName]) * weight / 16;
        } else {
            team1Total += team1.stats[weightName] * weight;
            team2Total += team2.stats[weightName] * weight;
        }
    }
    let winningPct;
    if ((team1Total === team2Total && team1.Rank < team2.Rank) || team1Total > team2Total) {
        team1El.classList.remove('loser');
        team1El.classList.add('winner');
        team2El.classList.remove('winner');
        team2El.classList.add('loser');
        winningPct = getWinningPct(team1Total, team2Total);
        return [team1, winningPct, team2, team2.stats.Seed < team1.stats.Seed];
    } else {
        team2El.classList.remove('loser');
        team2El.classList.add('winner');
        team1El.classList.remove('winner');
        team1El.classList.add('loser');
        winningPct = getWinningPct(team2Total, team1Total);
        return [team2, winningPct, team1, team1.stats.Seed < team2.stats.Seed];
    }
}

function getWinningPct(winnerTotal, loserTotal) {
    let winningPct = Math.ceil((2 * (100 * winnerTotal / (winnerTotal + loserTotal))) - 100);
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
    if (gameNumber === 15) return 4;
    return null;
}
/*
 * Loop through the list of weights, calculating the relative values.
 * Then loop through each matchup, determining the winner and updating the bracket
 */

function submit(logEvent) {
    let totalWeight = 0;
    headers.forEach(function (param) {
        const id = attrToID(param);
        if (nonStatHeaders.indexOf(id) > -1) return;

        totalWeight += currentWeights[id];
    });
    if (totalWeight === 0) {
        clear(true);
        weightsToURL();
        return;
    }

    for (let matchupID = 0; matchupID < firstFours.length; matchupID++) {
        const matchupEl = document.getElementById('matchup' + matchupID);
        const team1El = matchupEl.querySelector('.team1');
        const team2El = matchupEl.querySelector('.team2');
        const winnerData = runMatchup(firstFours[matchupID][0], firstFours[matchupID][1], team1El, team2El);
        const winner = winnerData[0];
        bracketTeamsByRegionAndSeed[winner.Region][winner.stats.Seed] = winner;
        document.getElementById(regions[winner.Region].toLowerCase() + 'seed' + winner.stats.Seed).textContent = winner.stats.Seed + '. ' + winner.Name;
    }

    let correctCount = 0;
    let correctScore = 0;
    let upsetCount = 0;
    const gameWinnerRegions = [{}, {}, {}, {}];
    for (let regionID = 0; regionID < regions.length; regionID++) {
        const currentRegion = bracketTeamsByRegionAndSeed[regionID];
        const gameWinners = gameWinnerRegions[regionID];
        const region = regions[regionID].toLowerCase();
        // First round of 64
        for (let index = 0; index < seedMatchOrder.length; index++) {
            const seed = seedMatchOrder[index];
            const high = currentRegion[seed];
            const low = currentRegion[17 - seed];
            // game numbers #ids are 1-indexed rather than 0-indexed
            const gameNum = index + 1;
            const highEl = document.getElementById(region + 'seed' + high.stats.Seed);
            const lowEl = document.getElementById(region + 'seed' + low.stats.Seed);

            const winnerData = runMatchup(high, low, highEl, lowEl);
            const winner = winnerData[0];
            const winnerPct = winnerData[1];
            const loser = winnerData[2];
            const upset = winnerData[3];
            if (upset) {
                upsetCount++;
            }
            gameWinners['game' + String(gameNum)] = winner;

            document.getElementById(region + 'seed' + winner.stats.Seed).classList.remove('loser');
            document.getElementById(region + 'seed' + winner.stats.Seed).classList.add('winner');

            const gameEl = document.getElementById(region + 'game' + gameNum);
            gameEl.textContent = winner.stats.Seed + '. ' + winner.Name + ' ' + winnerPct + '%';
            if (totalGames > 0 && (winner['Games Won'] > 0 || loser['Games Won'] > 0)) {
                if (winner['Games Won'] > 0) {
                    correctCount++;
                    correctScore += 1;
                    gameEl.classList.remove('incorrect');
                    gameEl.classList.add('correct');
                } else {
                    gameEl.classList.remove('correct');
                    gameEl.classList.add('incorrect');
                }
            } else {
                gameEl.classList.remove('incorrect');
                gameEl.classList.remove('correct');
            }
        }
        // Round of 32 through the Elite 8
        let gameDiff = 8;
        for (let game = 9; game < 16; game++) {
            const high = gameWinners['game' + String(game - gameDiff)];
            const low = gameWinners['game' + String(game + 1 - gameDiff)];
            const highEl = document.getElementById(region + 'game' + String(game - gameDiff));
            const lowEl = document.getElementById(region + 'game' + String(game + 1 - gameDiff));
            const winnerData = runMatchup(high, low, highEl, lowEl);
            const winner = winnerData[0];
            const winnerPct = winnerData[1];
            const loser = winnerData[2];
            const upset = winnerData[3];
            if (upset) {
                upsetCount++;
            }
            gameWinners['game' + String(game)] = winner;
            const gameEl = document.getElementById(region + 'game' + game);
            gameEl.textContent = winner.stats.Seed + '. ' + winner.Name + ' ' + winnerPct + '%';

            const round = getRound(game);
            if (totalGames > 0 && (winner['Games Won'] >= round || loser['Games Won'] >= round)) {
                if (winner['Games Won'] >= round) {
                    correctCount++;
                    if (game <= 12) correctScore += 2;
                    else if (game <= 14) correctScore += 4;
                    else correctScore += 8;
                    gameEl.classList.remove('incorrect');
                    gameEl.classList.add('correct');
                } else {
                    gameEl.classList.remove('correct');
                    gameEl.classList.add('incorrect');
                }
            } else if (totalGames > 1 && highestGamesPlayed > winner['Games Won']) {
                gameEl.classList.remove('correct');
                gameEl.classList.add('incorrect');
            } else {
                gameEl.classList.remove('correct');
                gameEl.classList.remove('incorrect');
            }
            gameDiff--;
        }
    }
    // Final four and championship game
    let regionID = 0;
    const sides = ['left', 'right'];
    const championship = {};
    for (let side = 0; side < sides.length; side++) {
        const region1 = regionID;
        const region2 = regionID + 1;
        const team1 = gameWinnerRegions[region1].game15;
        const team1El = document.getElementById(regions[region1].toLowerCase() + 'game15');
        const team2El = document.getElementById(regions[region2].toLowerCase() + 'game15');
        const team2 = gameWinnerRegions[region2].game15;
        const winnerData = runMatchup(team1, team2, team1El, team2El);
        const winner = winnerData[0];
        const winnerPct = winnerData[1];
        const loser = winnerData[2];
        const upset = winnerData[3];
        if (upset) {
            upsetCount++;
        }
        championship[sides[side]] = winner;

        const sideEl = document.getElementById(sides[side] + 'game');
        sideEl.textContent = winner.stats.Seed + '. ' + winner.Name + ' ' + winnerPct + '%';
        if (totalGames > 0 && (winner['Games Won'] >= 5 || loser['Games Won'] >= 5)) {
            if (winner['Games Won'] >= 5) {
                correctCount++;
                correctScore += 16;
                sideEl.classList.remove('incorrect');
                sideEl.classList.add('correct');
            } else {
                sideEl.classList.remove('correct');
                sideEl.classList.add('incorrect');
            }
        } else if (totalGames > 0 && highestGamesPlayed >= 5) {
            sideEl.classList.remove('correct');
            sideEl.classList.add('incorrect');
        } else {
            sideEl.classList.remove('correct');
            sideEl.classList.remove('incorrect');
        }
        // Populate mini FF game (both teams)
        const miniPrefix = 'mini-ff-' + sides[side] + '-';
        const miniEl1 = document.getElementById(miniPrefix + '1');
        const miniEl2 = document.getElementById(miniPrefix + '2');
        if (miniEl1 && miniEl2) {
            const isTeam1Winner = winner === team1;
            const miniWinEl = isTeam1Winner ? miniEl1 : miniEl2;
            const miniLoseEl = isTeam1Winner ? miniEl2 : miniEl1;
            miniEl1.textContent = team1.stats.Seed + '. ' + team1.Name;
            miniEl2.textContent = team2.stats.Seed + '. ' + team2.Name;
            miniLoseEl.classList.remove('correct', 'incorrect', 'mini-winner');
            miniLoseEl.classList.add('mini-loser');
            miniWinEl.classList.remove('mini-loser');
            miniWinEl.classList.add('mini-winner');
            ['correct', 'incorrect'].forEach(function(cls) {
                miniWinEl.classList.toggle(cls, sideEl.classList.contains(cls));
            });
        }
        regionID += 2;
    }
    const leftEl = document.getElementById('leftgame');
    const rightEl = document.getElementById('rightgame');
    const champEl = document.getElementById('championship');
    const winnerData = runMatchup(championship.left, championship.right, leftEl, rightEl);
    const winner = winnerData[0];
    const winnerPct = winnerData[1];
    const loser = winnerData[2];
    const upset = winnerData[3];
    if (upset) {
        upsetCount++;
    }
    if (totalGames > 0 && (winner['Games Won'] === 6 || loser['Games Won'] === 6)) {
        if (winner['Games Won'] === 6) {
            correctCount++;
            correctScore += 32;
            champEl.classList.remove('incorrect');
            champEl.classList.add('correct');
        } else {
            champEl.classList.remove('correct');
            champEl.classList.add('incorrect');
        }
    } else if (totalGames > 0 && highestGamesPlayed === 6) {
        champEl.classList.remove('correct');
        champEl.classList.add('incorrect');
    } else {
        champEl.classList.remove('correct');
        champEl.classList.remove('incorrect');
    }
    champEl.textContent = winner.stats.Seed + '. ' + winner.Name + ' ' + winnerPct + '%';

    // Populate mini championship (both teams)
    const miniChamp1El = document.getElementById('mini-champ-1');
    const miniChamp2El = document.getElementById('mini-champ-2');
    if (miniChamp1El && miniChamp2El) {
        const isLeftWinner = winner === championship.left;
        const miniChampWinEl = isLeftWinner ? miniChamp1El : miniChamp2El;
        const miniChampLoseEl = isLeftWinner ? miniChamp2El : miniChamp1El;
        miniChamp1El.textContent = championship.left.stats.Seed + '. ' + championship.left.Name;
        miniChamp2El.textContent = championship.right.stats.Seed + '. ' + championship.right.Name;
        miniChampLoseEl.classList.remove('correct', 'incorrect', 'mini-winner');
        miniChampLoseEl.classList.add('mini-loser');
        miniChampWinEl.classList.remove('mini-loser');
        miniChampWinEl.classList.add('mini-winner');
        ['correct', 'incorrect'].forEach(function(cls) {
            miniChampWinEl.classList.toggle(cls, champEl.classList.contains(cls));
        });
        requestAnimationFrame(updateMiniConnector);
    }

    document.getElementById('upset').textContent = upsetCount;
    if (tournamentStarted || currYear !== latestYear) {
        document.querySelectorAll('#scoring-wrapper > div > h1').forEach(function (el) {
            el.style.color = '';
        });
        document.getElementById('correct').textContent = String(correctCount) + ' / ' + String(totalGames);
        document.getElementById('score').textContent = String(correctScore) + ' / ' + String(totalScore);
    } else {
        clearScoreDisplay();
    }
    weightsToURL();
    syncMobileBracket();
    if (logEvent) {
        const payload = {
            action: 'render',
            weights: saveCookie(),
            activity: currActivity,
            correctScore: correctScore,
            year: currYear
        };
        const params = new URLSearchParams(payload);
        fetch("https://alebracket-tracking-237201124851.us-central1.run.app?" + params);
    }
}

function clear(setup) {
    const classesToRemove = ['winner', 'loser', 'correct', 'incorrect'];
    // Easier to just wipe everything and rerun the setup
    for (let regionID = 0; regionID < regions.length; regionID++) {
        const regionName = regions[regionID].toLowerCase();
        document.querySelectorAll('[id^=' + regionName + 'game]').forEach(function (el) {
            el.classList.remove(...classesToRemove);
            el.textContent = '';
        });
        document.querySelectorAll('[id^=' + regionName + 'seed]').forEach(function (el) {
            el.classList.remove(...classesToRemove);
        });
    }
    document.getElementById('play-in').textContent = '';
    ['leftgame', 'rightgame', 'championship'].forEach(function (id) {
        const el = document.getElementById(id);
        el.classList.remove(...classesToRemove);
        el.textContent = '';
    });
    ['mini-ff-left-1', 'mini-ff-left-2', 'mini-ff-right-1', 'mini-ff-right-2',
     'mini-champ-1', 'mini-champ-2'].forEach(function(id) {
        const el = document.getElementById(id);
        if (el) {
            el.textContent = '';
            el.classList.remove('correct', 'incorrect', 'mini-winner', 'mini-loser');
        }
    });
    const connSvg = document.getElementById('mini-connector-svg');
    if (connSvg) { connSvg.innerHTML = ''; }

    // Reset mobile bracket
    mobileBracketBuilt = false;
    var mbContainer = document.getElementById('mobile-bracket');
    if (mbContainer) mbContainer.innerHTML = '';

    if (setup) {
        document.getElementById('upset').textContent = '0';
        setupInitialMatches();
    } else {
        for (let regionID = 0; regionID < regions.length; regionID++) {
            for (let seed = 1; seed < 17; seed++) {
                const region = regions[regionID].toLowerCase();
                document.getElementById(region + 'seed' + seed).textContent = '';
            }
        }
    }
}

/*
 * Resets all sliders to zero, clearing the bracket.
 */
function resetSliders() {
    headers.forEach(function (param) {
        if (param in nonStatHeaders) return;

        const container = document.getElementById(attrToID(param));
        if (container) container.querySelector('input').value = 0;
        const valEl = document.getElementById(attrToID(param) + '-val');
        if (valEl) valEl.textContent = '0';
    });
    for (const key in currentWeights) {
        currentWeights[key] = 0;
    }
    Cookies.remove('w');
    clear(true);
}

/*
 * Converts the statistic name to the id used in js objects and html ids.
 */

function attrToID(attr) {
    if (nonStatHeaders.indexOf(attr) > -1 || attr === 'Seed') return attr;
    const short = attr.replace(/%/, 'P').replace(/[\ a-z%\.\/]/g, '');
    return short;
}

function weightsToURL() {
    // Create the URL
    const weightValue = saveCookie();
    if (window.ga && ga.loaded) {
        ga('send', 'event', 'bracket', 'build', '', weightValue);
    }
    let path = document.URL.split('?')[0] + '?w=' + weightValue;
    if (path.substring(0, 4) !== "http") {
        path = 'https://' + path;
    }
    if (currActivity !== defaultActivity) {
        path += '&a=' + currActivity;
    }

    document.getElementById('share').value = path;
    document.getElementById('twitter-share').innerHTML = '<a class="twitter-share-button social-link" data-text="Check out my #Algebracket!" data-url="' + path + '">Tweet</a>';
    if (typeof twttr !== 'undefined' && twttr.widgets !== undefined) {
        twttr.widgets.load();
    }
    return path;
}

function saveCookie() {
    const sortedWeights = [];
    let urlValue = YearToURLParam(currYear);
    for (const k in currentWeights) {
        sortedWeights.push(k);
    }
    sortedWeights.sort();
    for (let i = 0; i < sortedWeights.length; i++) {
        let weightVal = String(currentWeights[sortedWeights[i]]);
        if (weightVal === '10') {
            weightVal = 'A';
        }
        urlValue += weightVal;
    }
    Cookies.set('w', urlValue);
    Cookies.set('activity', currActivity);
    return urlValue;
}

function URLToWeights(urlParams) {
    console.log('URLToWeights', urlParams);
    const sortedWeights = [];
    for (const k in currentWeights) {
        sortedWeights.push(k);
    }
    sortedWeights.sort();
    if (urlParams.w.length === 0 && Cookies.get('w') !== undefined) {
        urlParams.w = Cookies.get('w');
    }
    if ((!urlParams.hasOwnProperty('a') || urlParams.a.length === 0) && Cookies.get('activity') !== undefined) {
        currActivity = Cookies.get('activity');
    }
    if (initialLoad) {
        for (let i = 1; i < urlParams.w.length; i++) {
            let weightVal = urlParams.w[i];
            if (weightVal === 'A') {
                weightVal = 10;
            } else {
                weightVal = parseInt(weightVal, 10);
            }
            const weightName = sortedWeights[i - 1];
            const container = document.getElementById(weightName);
            if (container) container.querySelector('input').value = weightVal;
            currentWeights[weightName] = weightVal;
            const valEl = document.getElementById(weightName + '-val');
            if (valEl) valEl.textContent = weightVal;
        }
    }
}

function URLParamToYear(paramChar) {
    return (2010 + parseInt(paramChar, 36)).toString();
}

function YearToURLParam(year) {
    return (parseInt(year, 10) - 2010).toString(36).toUpperCase();
}
