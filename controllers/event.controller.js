const Event = require('../models/Event');

exports.createEvent = async (req, res, next) => {
  try {
    const { user, eventType, device, details, payload, timestamp, role } = req.body;

    const event = await Event.create({
      user,
      eventType,
      device,
      details,
      payload,
      timestamp: timestamp ? new Date(timestamp) : new Date(),
      role
    });

    res.status(201).json({
      success: true,
      data: event
    });
  } catch (error) {
    next(error);
  }
};

exports.getEvents = async (req, res, next) => {
  try {
    // Return last 1000 events to feed the telemetry dashboard, sorted by newest
    const events = await Event.find()
      .sort({ timestamp: -1 })
      .limit(1000);

    res.json({
      success: true,
      data: events
    });
  } catch (error) {
    next(error);
  }
};
