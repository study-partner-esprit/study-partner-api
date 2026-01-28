const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      message: 'Resource not found',
      path: req.originalUrl
    }
  });
};

module.exports = notFoundHandler;
