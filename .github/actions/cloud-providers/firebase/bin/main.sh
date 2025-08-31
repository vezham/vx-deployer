#!/bin/bash

# $name (accounts, business, hq,..)
# $dir (path to ROOT_DIR from Working Dir)
# $1 - name (vx/config/firebase/$name.json)
# $2 - dir (../../v)

name=${1:-"app"}
dir=${2:-"../.."}

pwd
ls

# read config
config=`cat $dir/vx/config/firebase/$name.json`

# switch for hosting from ROOT
cd $dir

pwd
ls

# create firebase.json file
touch "firebase.json"

pwd
ls

# write config to firebase.json
echo $config >> firebase.json

pwd
ls