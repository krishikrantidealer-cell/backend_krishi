const Promise = require('bluebird'); // Or native
async function test() {
  const p1 = Promise.resolve(1);
  const p2 = Promise.resolve(2);
  const nonPromise = [1, 2, 3];
  
  const [r1, r2, r3] = await Promise.all([p1, p2, nonPromise]);
  console.log(r3);
}
test();
