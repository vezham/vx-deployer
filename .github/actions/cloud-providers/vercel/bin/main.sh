#!/bin/bash

# $name (__mocks__ - apps_pods/accounts, apps_pods/business, apps_suits/hq,..)
# $1 - name (vx/config/vercel/$name.json)

name=${1:-"__mocks__/mock"}

# read config
config=`cat vx/config/vercel/$name.json`

# wjdlz/TODO: check need for switch to hosting from ROOT
# cd $dir # ${{ env.ENTRY_POINT }}

# create vercel.json file
touch "vercel.json"

# write config to vercel.json
echo $config >> vercel.json
