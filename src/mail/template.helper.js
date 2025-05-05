export const isEqual = function (a, b, options) {
  if (a == b) {
    return options.fn(this);
  } else {
    return options.inverse(this);
  }
};

export const isOrganizer = function (organizedId, participantId, options) {
  if (organizedId == participantId) {
    return options.fn(this);
  } else {
    return options.inverse(this);
  }
};

export const isCreator = function (creatorId, participantId, options) {
  if (creatorId == participantId) {
    return options.fn(this);
  } else {
    return options.inverse(this);
  }
};
