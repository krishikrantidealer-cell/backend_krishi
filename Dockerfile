# Use the official lightweight Node.js active LTS image.
FROM node:20-slim

# Set working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy local code to the container image.
COPY . .

# Expose port (Cloud Run will inject PORT env var, our app listens on process.env.PORT)
EXPOSE 8080

# Run the web service on container startup.
CMD [ "npm", "start" ]
