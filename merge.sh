#!/bin/bash
set -e -o pipefail

git checkout gh-pages
git merge master
git push
git checkout master
git push
