require("dotenv").config();
const {
  Client,
  TopicCreateTransaction,
  TopicMessageQuery,
  TopicMessageSubmitTransaction,
  PrivateKey,
  AccountCreateTransaction,
  Hbar,
} = require("@hashgraph/sdk");

// If we want to subscribe to a topic immediately after creation, we must ensure that the topicId is available on the mirror nodes. One common way to ensure it's available is to set a 5-second delay.
function delay(time) {
  // pauses the script for a specified amount of time
  return new Promise((resolve) => setTimeout(resolve, time));
}

async function createMessageQueue() {
  const myAccountId = process.env.MY_ACCOUNT_ID;
  const myPrivateKey = process.env.MY_PRIVATE_KEY;

  if (myAccountId == null || myPrivateKey == null) {
    throw new Error("account ID or Private key are missing");
  }

  const client = Client.forTestnet();
  client.setOperator(myAccountId, myPrivateKey);

  // Part 1 - Create topic
  // The first step in creating a message queue is creating a topic. A topic refers to a channel on the Hedera network that’s used to send and receive messages.
  // You have the option of creating a public or private topic. A public topic is one that does not have a topic key meaning that anyone can submit messages to that topic. On the other hand, a private topic can be optionally set with a topic key .setASubmitKey().
  // Below is a public topic
  const createTopicTransactionId = await new TopicCreateTransaction().execute(
    client
  );
  const createTopicReceipt = await createTopicTransactionId.getReceipt(client);
  const newTopicId = createTopicReceipt.topicId;
  console.log("The new topic ID is " + newTopicId);

  // Part 2 - Subscribe to topic (using a Hedera Mirror Node)
  await delay(5000); // 5sec delay to ensure the topicId is available on the mirror nodes

  new TopicMessageQuery()
    .setTopicId(newTopicId)
    .setStartTime(0)
    .subscribe(client, null, (message) => {
      let messageAsString = Buffer.from(message.contents, "utf8").toString();
      console.log(
        `${message.consensusTimestamp.toDate()} Received: ${messageAsString}`
      );
    });

  // Part 3 - Submit messages to topic
  // const newHCSMessage = await new TopicMessageSubmitTransaction()
  //   .setTopicId(newTopicId)
  //   .setMessage("Hedera rocks!")
  //   .execute(client);
  // const messageReceipt = await newHCSMessage.getReceipt(client);
  // console.log(messageReceipt);
  // In the receipt, The topicSequenceNumber object stores the ordered number of messages that have been submitted to the Hedera network in this topic.
  // topicRunningHash - this is a tamper-proof running hash that verifies the integrity of the message submitted

  // Submitting messages to same topic from multiple accounts
  let retries;
  const MAX_RETRIES = 20;
  for (let i = 1; i <= 7; i++) {
    retries = 0;
    while (retries < MAX_RETRIES) { // retry the transaction if it fails (BUSY error etc.)
      try {
        // Create new account
        const newAccountPrivateKey = PrivateKey.generateED25519();
        const newAccountPublicKey = newAccountPrivateKey.publicKey;

        const newAccount = await new AccountCreateTransaction()
          .setKey(newAccountPublicKey)
          .setInitialBalance(Hbar.fromTinybars(100000000))
          .execute(client);

        const getReceipt = await newAccount.getReceipt(client);
        const newAccountId = getReceipt.accountId;

        // Submit message to topic from new account
        const newClient = Client.forTestnet();
        newClient.setOperator(newAccountId, newAccountPrivateKey);
        await new TopicMessageSubmitTransaction()
          .setTopicId(newTopicId)
          .setMessage(
            `Aniket has an account with account id ${newAccountId} that completed action no. ${i}`
          )
          .execute(newClient);
        
        break;
      } catch (err) {
        // If the error is BUSY, retry the transaction
        if (err.toString().includes("BUSY")) {
          retries++;
          // console.log(`Retry attempt: ${retries}`);
        } else {
          // If the error is not BUSY, throw the error
          throw err;
        }
      }
    }
    // throw new Error(`Transaction failed after ${MAX_RETRIES} attempts`);
  }

  client.close();
}

createMessageQueue();
