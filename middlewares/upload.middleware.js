const multer = require('multer');

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ];

  if (file.mimetype.startsWith('image/') || allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only images, PDFs, and Word documents are allowed!'), false);
  }
};

const upload = multer({
  storage: storage,
  // Accept all files and extensions to support any documents, media, catalogs, or archives
  limits: {
    fileSize: 35 * 1024 * 1024, // Up to 35MB
  },
});

module.exports = upload;
