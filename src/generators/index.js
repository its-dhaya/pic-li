'use strict';

const generators = {
  'react-vite':    require('./react/vite'),
  'react-cra':     require('./react/cra'),
  'react-native':  require('./react/native'),
  nextjs:          require('./frontend/nextjs'),
  vue:             require('./frontend/vue'),
  angular:         require('./frontend/angular'),
  express:         require('./backend/express'),
  nestjs:          require('./backend/nestjs'),
  'spring-boot':   require('./backend/spring-boot'),
  'spring-gradle': require('./backend/spring-boot'),
  fastapi:         require('./backend/fastapi'),
  flask:           require('./backend/flask'),
  django:          require('./backend/django'),
  flutter:         require('./mobile/flutter'),
  mern:            require('./fullstack/mern'),
  go:              require('./misc/go'),
};

function getGenerator(stackId) {
  return generators[stackId] || null;
}

module.exports = { getGenerator };
