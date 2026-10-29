function productImageUrl(imageUrl) {
  if (!imageUrl || /^(?:https?:)?\/\//i.test(imageUrl) || /^data:image\//i.test(imageUrl) || imageUrl.startsWith("/")) {
    return imageUrl;
  }

  return `/${imageUrl.replace(/\\/g, "/")}`;
}

module.exports = productImageUrl;
