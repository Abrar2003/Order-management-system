const EudrChain = require("../models/eudrChain.model");
const Allocation = require("../models/eudrAllocation.model");
const { fail, key, contributionMilliCft } = require("./eudrChain.service");
const { isTransactionUnsupportedError } = require("../helpers/transactionalController");

const ensureIndexes = async () => {
  await EudrChain.createIndexes();
  await Allocation.createCollection();
  const indexes = await EudrChain.collection.indexes();
  for (const index of indexes) {
    if (index.unique && Object.keys(index.key).length === 2 && index.key.container_key === 1 && index.key.vendor === 1) {
      try { await EudrChain.collection.dropIndex(index.name); }
      catch (error) { if (error.code !== 27) throw error; }
    }
  }
};

const withAllocation = async (container, vendor, operation) => {
  if (EudrChain.db.$supportsTransactions === false) throw fail("EUDR allocation changes require MongoDB transaction support", 503);
  try {
    return await EudrChain.db.transaction(async (session) => {
      await Allocation.findOneAndUpdate({ _id: `${key(container)}|${vendor}` }, { $inc: { revision: 1 } }, { upsert: true, session });
      const chains = await EudrChain.find({ container_key: key(container), vendor }).session(session);
      return operation(chains, session);
    });
  } catch (error) {
    if (isTransactionUnsupportedError(error)) throw fail("EUDR allocation changes require MongoDB transaction support. No changes were saved.", 503);
    throw error;
  }
};

const assertAllocation = (chains, contribution, stuffed, exceptId) => {
  const allocated = chains.filter((chain) => String(chain._id) !== String(exceptId || "")).reduce((sum, chain) => sum + contributionMilliCft(chain), 0);
  if (allocated + contribution > stuffed) throw fail(`Chain contribution exceeds the available ${((stuffed - allocated) / 1000).toFixed(3)} CFT. Reduce another chain's contribution first.`, 409);
};

module.exports = { ensureIndexes, withAllocation, assertAllocation };
