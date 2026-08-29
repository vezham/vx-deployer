#!/bin/bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# use mock config for now
cp "$script_dir/mock.json" "vercel.json"
