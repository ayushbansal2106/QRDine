const QRCode = require('qrcode');

const generateQRCode = async (url) => {
  const qrDataUrl = await QRCode.toDataURL(url);

  return {
    qrDataUrl,
  };
};

module.exports = generateQRCode;
