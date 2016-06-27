weighted-bracket-picker
=======================

A March Madness bracket picker using weighted statistics. Provides historical data back to 2010 as well as up to date data through the current season.

Features
========
* Switch between tournament years using the dropdown in the center to compare scores historically, then use the current year to build a bracket based off the seeding.
* Share your weights using the url in the input field at the top
* Come back later and your weight choices will persist via cookies

Technical Info
==============
* Data comes from http://stats.ncaa.org/ and is stored in the CSV files within the repo
* Because none of this requires server-side processing, the app is able to live in an entirely static environment on github.io
* The list of stats and their slides is dynamically generated based on the CSV files
* Different years have different numbers of play-in games. This tool is able to account for that based on the number of teams with identical seeds.

To Do List
==========
* Come up with better visual representation of bracket (canvas? reactjs?)
* Extend this beyond march madness to support other sports, or any sort of tournament with publically available statistics
