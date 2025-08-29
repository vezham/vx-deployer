echo "v" >> .git/modules/v/info/sparse-checkout
git sparse-checkout set "v"

echo "v/handbooks" >> .git/modules/v/info/sparse-checkout
git sparse-checkout set "v/handbooks"

rm -rf v

echo "v/handbooks" >> .git/info/sparse-checkout

git submodule add "https://github.com/vezham/v0xFE-SM-kit.git" external/Robot
cd external/Robot
git sparse-checkout init --cone
git sparse-checkout set "v"

git sparse-checkout set "v/handbooks"

echo "/v/handbooks/" >> .git/modules/v1x/info/sparse-checkout

rm -rf v1x
