const express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const cors = require("cors");
const app = express();
const port = process.env.PORT || 5000;
const textlink = require("textlink-sms");

//========== Middlewares ==========
app.use(
  cors({
    origin: [
      "https://ravetagbd.web.app",
      "https://ravetag-76898.web.app",
      "http://localhost:5173",
    ],
    credentials: true,
  })
);
app.use(express.json());
require("dotenv").config();
textlink.useKey(process.env.TEXTLINK_API_KEY);

//========== MongoDB ==========
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.4fuek.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.jazz428.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    client.connect();
    // Send a ping to confirm a successful connection
    client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );

    // ========== MongoDB Collections ==========
    const productsCollection = client.db("ravetag").collection("products");
    const categoriesCollection = client.db("ravetag").collection("categories");
    const customersCollection = client.db("ravetag").collection("customers");
    const ordersCollection = client.db("ravetag").collection("orders");
    const externalLinkVisitsCollection = client
      .db("ravetag")
      .collection("external_link_visits");

    // ========== Middlewares ==========
    const admin_auth = async (req, res, next) => {
      try {
        const token = req.body.token || req.query.token;
        // console.log(token);
        if (token && token === process.env.ADMIN_TOKEN) {
          next();
        } else {
          return res.status(401).send({ message: "UNAUTHORIZED" });
        }
      } catch (error) {
        return res.status(403).send({ message: "AUTHORIZATION ERROR" });
      }
    };

    //========== APIs ==========
    // Get Product/s
    app.get("/api/v1/products", async (req, res) => {
      try {
        const { id, category, top_sales } = req.query;
        const filter = {};
        // if (id && id == "null") {
        //   console.log("Null id");
        //   return res.send({ result: [] });
        // }
        if (id) {
          filter._id = ObjectId.createFromHexString(id);
        }
        if (category) {
          filter.category = category;
        }
        let result;
        if (top_sales) {
          result = await productsCollection
            .find(filter)
            .sort({ sales: -1 })
            .toArray();
        } else {
          result = await productsCollection.find(filter).toArray();
        }
        return res.send(result);
      } catch (error) {
        return res.status(400).send({ message: "error", error });
      }
    });

    // Get Product Price
    app.get("/api/v1/product-price", async (req, res) => {
      const { id } = req.query;
      const product = await productsCollection.findOne({
        _id: ObjectId.createFromHexString(id),
      });
      if (product) {
        const price = product?.offer_price;
        return res.send({ result: price });
      } else {
        return res.send({ message: "not_found", result: 0 });
      }
    });

    // Get Categories
    app.get("/api/v1/categories", async (req, res) => {
      try {
        const result = await categoriesCollection.find().toArray();
        const categories = result?.[0]?.categories;
        return res.send({ result: categories });
      } catch (error) {
        return res.status(404).send({ message: "error", error });
      }
    });

    // Place order
    app.post("/api/v1/place-order", async (req, res) => {
      try {
        const { order_details } = req.body;
        const result = await ordersCollection.insertOne(order_details);

        order_details?.order?.map((item) => {
          let productId = item?.id || item?._id;
          let selectedVariant = item?.color;
          let selectedSize = item?.size;
          const productObjectId = ObjectId.createFromHexString(productId);

          const updateStock = async () => {
            const result = await productsCollection.updateOne(
              {
                _id: productObjectId,
                "variants.name": selectedVariant,
                "variants.sizes.size": selectedSize,
              },
              {
                $inc: {
                  "variants.$[variant].sizes.$[size].stock": -item?.quantity,
                },
              },
              {
                arrayFilters: [
                  { "variant.name": selectedVariant },
                  { "size.size": selectedSize },
                ],
              }
            );
            console.log(result);
          };

          updateStock();
        });

        const updateCustomer = await customersCollection.replaceOne(
          { phone: order_details?.customer?.phone },
          order_details?.customer,
          { upsert: true }
        );
        if (result?.insertedId) {
          return res.send({ message: "success", id: result?.insertedId });
        } else {
          return res.send({
            message: "Failed to place order, please try again.",
          });
        }
      } catch (error) {
        console.log(error);
        return res.status(404).send({ message: "error", error });
      }
    });

    // Cancel order
    app.post("/api/v1/cancel-order", async (req, res) => {
      try {
        const { c_id } = req.body;
        const result = await ordersCollection.updateOne(
          { c_id: c_id },
          {
            $set: {
              status: "cancelled",
            },
          }
        );

        if (result?.modifiedCount > 0) {
          return res.send({ message: "success" });
        } else {
          return res.send({
            message: "Failed to cancel order, please try again.",
          });
        }
      } catch (error) {
        console.log(error);
        return res.status(404).send({ message: "error", error });
      }
    });

    // Change Order Status
    app.put("/api/v1/change-order-status", admin_auth, async (req, res) => {
      try {
        const { id, status } = req.body;

        const result = await ordersCollection.updateOne(
          { _id: ObjectId.createFromHexString(id) },
          {
            $set: {
              status: status,
            },
          }
        );

        if (result?.modifiedCount > 0) {
          return res.send({ message: "success" });
        } else {
          return res.send({ message: "failed to update status" });
        }
      } catch (error) {
        console.log(error);
        return res
          .status(404)
          .send({ message: error?.message || "error", error });
      }
    });

    // Send OTP
    app.get("/api/v1/otp", async (req, res) => {
      try {
        const { phone } = req.query;
        const phone_number = `+${phone}`;

        // console.log(phone_number);

        const sendCode = await textlink.sendVerificationSMS(phone_number, {
          service_name: "RaveTag",
          expiration_time: 10 * 60 * 1000,
          source_country: "BD",
        });

        // console.log(sendCode);

        if (sendCode?.ok) {
          return res.status(200).send({ status_code: 200, message: "success" });
        } else {
          return res
            .status(200)
            .send({ status_code: 400, message: sendCode?.message });
        }
      } catch (error) {
        console.log(error);
        return res.status(404).send({ message: "error", error });
      }
    });

    // Verify OTP
    app.get("/api/v1/verify-phone", async (req, res) => {
      try {
        const { phone, otp } = req.query;
        // const result = await textflow.verifyCode(`+${phone}`, otp);
        // console.log("=>", `+${phone}`, otp);
        const result = await textlink.verifyCode(`+${phone}`, otp);

        // return res.status(result?.status).send({
        //   valid: result?.valid,
        //   status_code: result?.status,
        //   message: result?.message,
        //   valid_code: result?.valid_code,
        // });

        // console.log(result);
        if (result?.ok) {
          return res.status(200).send({
            valid: true,
            status_code: 200,
            message: "verified",
          });
        } else {
          return res.status(200).send({
            valid: false,
            status_code: 400,
            message: result?.message || "invalid",
          });
        }
      } catch (error) {
        console.log(error);
        return res.status(404).send({ message: "error", error });
      }
    });

    // Update Customer
    app.post("/api/v1/customer", async (req, res) => {
      try {
        const { customerData } = req.body;
        const result = await customersCollection.replaceOne(
          { phone: customerData?.phone },
          customerData,
          { upsert: true }
        );
        // console.log(result);
        if (
          result?.upsertedId ||
          result?.modifiedCount > 0 ||
          result?.upsertedCount > 0
        ) {
          return res.send({ message: "success" });
        } else {
          return res.send({ message: "Failed to update data" });
        }
      } catch (error) {
        console.log(error);
        return res.status(404).send({ message: "error", error });
      }
    });

    // Get Orders
    app.get("/api/v1/orders", async (req, res) => {
      try {
        const { phone, pending, processing, delivered, cancelled } = req?.query;

        let filter = {};

        if (phone) {
          filter["customer.phone"] = `+${phone}`;
        } else {
          return res.status(403).send({ message: "FORBIDDEN", result: [] });
        }
        if (pending) {
          filter.status = "pending";
        } else if (processing) {
          filter.status = "processing";
        } else if (delivered) {
          filter.status = "delivered";
        } else if (cancelled) {
          filter.status = "cancelled";
        }

        const result = await ordersCollection.find(filter).toArray();
        return res.send({ result });
      } catch (error) {
        console.log(error);
        return res.status(404).send({ message: "error", error });
      }
    });

    // Get Orders (Admin)
    app.get("/api/v1/admin-orders", admin_auth, async (req, res) => {
      try {
        const { phone, pending, processing, delivered, cancelled } = req?.query;

        let filter = {};

        if (phone) {
          filter["customer.phone"] = `+${phone}`;
        }
        if (pending) {
          filter.status = "pending";
        } else if (processing) {
          filter.status = "processing";
        } else if (delivered) {
          filter.status = "delivered";
        } else if (cancelled) {
          filter.status = "cancelled";
        }

        const result = await ordersCollection.find(filter).toArray();
        return res.send({ result });
      } catch (error) {
        console.log(error);
        return res.status(404).send({ message: "error", error });
      }
    });

    // Post Product
    app.post("/api/v1/products", admin_auth, async (req, res) => {
      try {
        const { data } = req.body;
        const result = await productsCollection.insertOne(data);

        if (result?.insertedId) {
          return res.send({ message: "success" });
        } else {
          return res.send({ message: "failed to upload product" });
        }
      } catch (error) {
        console.log(error);
        return res.status(404).send({ message: "error", error });
      }
    });

    // Update Product
    app.put("/api/v1/products", admin_auth, async (req, res) => {
      try {
        const { data, id } = req.body;
        // console.log(JSON.stringify(data));
        const result = await productsCollection.replaceOne(
          { _id: ObjectId.createFromHexString(id) },
          data
        );

        if (result?.modifiedCount > 0) {
          return res.send({ message: "success" });
        } else {
          return res.send({ message: "failed to update product" });
        }
      } catch (error) {
        console.log(error);
        return res.status(404).send({ message: "error", error });
      }
    });

    // Delete Product
    app.delete("/api/v1/products", admin_auth, async (req, res) => {
      try {
        const { id } = req.query;

        const result = await productsCollection.deleteOne({
          _id: ObjectId.createFromHexString(id),
        });

        if (result?.deletedCount > 0) {
          return res.send({ message: "success" });
        } else {
          return res.send({ message: "failed to delete product" });
        }
      } catch (error) {
        return res
          .status(400)
          .send({ message: error?.message || "error", error });
      }
    });

    app.put("/api/v1/external-link-visit", async (req, res) => {
      try {
        const { user, datetime, name } = req.body;

        const doc = await externalLinkVisitsCollection.findOne({ name: name });

        const newEntry = { user, datetime };

        doc.visits.push(newEntry);

        const result = await externalLinkVisitsCollection.replaceOne(
          {
            name: name,
          },
          { name: doc.name, link: doc.link, visits: doc.visits }
        );

        // console.log(
        //   { name: doc.name, link: doc.link, visits: doc.visits },
        //   result
        // );

        return res.send({ message: "success" });
      } catch (error) {
        console.log(error);
        return res
          .status(400)
          .send({ message: error?.message || "error", error });
      }
    });
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World to RaveTag's server.");
});

app.listen(port, () => {
  console.log(`RaveTag server is running on port ${port}`);
});
