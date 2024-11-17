# Use the official Node.js image as the base image
FROM node:18

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy the package.json and package-lock.json files to install dependencies first
COPY package*.json ./

# Install the app dependencies
RUN npm install

# Copy the entire project into the container
COPY . .

# Expose the port the app runs on
EXPOSE 9000

# Run the app
CMD ["node", "server.js"]
