const path = require('path');

module.exports = {
    // Specify the entry point for your app
    entry: './main.js',
    // Specify the output file containing your bundled code
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'bundle.js',
    },
    // Specify the mode for webpack
    mode: 'development',
    // Add any additional plugins or loaders as needed
};
