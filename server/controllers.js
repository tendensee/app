const db = require('./db/db-config.js');
const config = require('./config.js');
const dbHelpers = require('./db/helpers.js');
const uploadS3 = require('./db/s3-config.js');
const Promise = require('bluebird');
// const zlib = require('zlib'); // USE THIS TO COMPRESS?
// const fs = require('fs');
const Clarifai = require('clarifai');

// SETUP IMAGE RECOGNITION
const imageRec = new Clarifai.App(config.imageId, config.imageSecret)

//PROMISIFY DB HELPERS
const createPromise = Promise.promisify(dbHelpers.create);
const retrievePromise = Promise.promisify(dbHelpers.retrieve);
const updatePromise = Promise.promisify(dbHelpers.update);
const deletePromise = Promise.promisify(dbHelpers.delete);

// USERS -------------------------------->
exports.getUserData = (req, res) => {
  let userId = 101; // LATER - get from front end? Session?
  let responseData = {};
  retrievePromise(dbHelpers.query('retrieveUser', userId))
  .then(user => {
    console.log('user:', user)
    let { id, username, email, facebook } = user[0];
    responseData['user'] = { id, username, email, facebook }
    retrievePromise(dbHelpers.query('retrieveUserHabits', userId))
    .then(habits => {
      habits.forEach(habit => {
        habit.has_picture = habit.has_picture.lastIndexOf(1) !== -1;
        habit.private = habit.private.lastIndexOf(1) !== -1;
        habit.dates = [];
      })
      console.log('habits:', habits)
      responseData['habits'] = habits;
      datePromises = responseData.habits.map(habit => {
        return retrievePromise(dbHelpers.query('retrieveDatesFromHabit', habit.id))
        .then(dates => {
          dates.forEach(day => {
            let { id, date, picture } = day;
            habit.dates.push({ id, date, picture });
            return day;
          })
        })
      })
      Promise.all(datePromises)
      .then(() => {
        console.log('resdata with all in controller:', responseData);
        res.json(responseData);
      })
    })
    .catch(err => console.log('Error getting user data from DB:', err))
  })
}

exports.addUser = (req, res) => {
  console.log('add user req.body:', req.body)
  createPromise(req.body, 'users')
  .then(user => {
    console.log('user:', user);
    res.status(201).json(user);
  })
  .catch(err => console.log('Error adding user to DB:', err))
}

// HABITS -------------------------------->
exports.addHabit = (req, res) => {
  console.log('add user req.body:', req.body)
  createPromise(req.body, 'habits')
  .then(habit => {
    res.status(201).json(habit);
  })
  .catch(err => console.log('Error adding habit to DB:', err))
}

// DATES ---------------------------------->
exports.addDate = (req, res) => {
  // DEAL WITH NO PICTURE INSTANCES!!!
  let id_users = req.body.id_users || 101; // GET RID OF OR ONCE USING
  let id_habits = req.body.id_habits.length ? req.body.id_habits : 12; // GET RID OF TERNARY ONCE USING
  let newDate = { id_users, id_habits };
  newDate.date = new Date();
  let imageRecData;

  uploadS3(req.body.path, pic =>{
    console.log('in s3 cb');
    newDate.picture = pic.Location;
    // LATER: if one habit, send immediately; if >1 do this: ALSO, if ONLY 1, TRAIN CLARIFAI!!!
    imageRec.models.predict(Clarifai.GENERAL_MODEL, newDate.picture)
    .then(data => {
      imageRecData = data;
      imageRecData.tags = data.outputs[0].data.concepts.map(item => item.name)
      // USE TAGS TO MATCH IMAGE TO HABIT (USER habit IDs ARE IN newDate.id_habits ARRAY -ONCE FIND CORRECT HABIT, OVERWRITE ID to id_habits)
      console.log('image recognized!!!:', imageRecData.tags)
      console.log('newDate right before add to sql', newDate)
      createPromise(newDate, 'dates')
      .then(date => {
        res.status(201).json(date)
      })
      .catch(err => console.log('Error adding date to DB:', err))
    }, err => {
      console.log(err);
    })
  })
}