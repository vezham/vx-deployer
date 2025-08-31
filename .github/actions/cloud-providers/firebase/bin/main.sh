#!/bin/bash

# $name (apps_pods/accounts, apps_pods/business, apps_suits/hq,..)
# $1 - name (vx/config/firebase/$name.json)

name=${1:-"app"}

# read config
config=`cat vx/config/firebase/$name.json`

# create firebase.json file
touch "firebase.json"

# write config to firebase.json
echo $config >> firebase.json
