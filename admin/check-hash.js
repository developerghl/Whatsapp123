const bcrypt = require('bcryptjs');

const hash = '$2a$10$GVSJLLkRUHhbZxU9rRo0TuTn14/jI7bWaQK2vBZ9QBlWDGA7r0Apa';
const password = 'Abujandal19!';

bcrypt.compare(password, hash).then(res => {
  console.log('MATCH:', res);
});
