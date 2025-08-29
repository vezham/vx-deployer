# Tags

---

### Delete

# Fetch remote tags.

git fetch #git fetch --all --tags

# Delete remote tags. | Pushing once should be faster than multiple times

git push origin --delete $(git tag -l)

# Delete local tags.

git tag -d $(git tag -l)

# For teammates

git fetch --all --tags --prune
